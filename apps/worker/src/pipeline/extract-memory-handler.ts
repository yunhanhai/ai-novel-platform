import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { createFakeModel } from "./fake-model";
import {
  MAX_ACCEPTED_CHARACTER_STATES_PER_PROJECT,
  enforceCharacterStateQuota,
  isDuplicateContent,
  maintainChapterSummary,
  supersedeCharacterState
} from "./memory-maintenance";
import type { GenerationJob } from "../poll";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type FakeModel = ReturnType<typeof createFakeModel>;

type UpdateStatusFn = (params: {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}) => Promise<unknown>;

interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
}

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  HANDLER_ERROR: "HANDLER_ERROR",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

interface ExtractOutput {
  characterChanges: { characterName: string; change: string }[];
  worldFacts: { fact: string }[];
  newHooks: { hook: string }[];
  summary: string;
  chapterSummary: string;
}

export function createExtractMemoryHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const chapterId = resolveChapterId(job);
    if (!chapterId) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "无法解析 chapterId");
      return;
    }

    // 模型解析：优先 resolveModel，其次 injected model，最后失败
    let model = builtinModel;
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
      } else if (!deps.model) {
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "无法解析 ModelProfile 且未启用兜底模型");
        return;
      }
    }

    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, content: true, title: true, chapterNo: true }
    });
    if (!chapter || !chapter.content) {
      await updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: "CHAPTER_NOT_FOUND", errorMessage: "章节不存在或正文为空" });
      return;
    }

    try {
      const extractPrompt = `你是小说记忆抽取器。分析本章正文，提取需要记录的信息。以 JSON 格式输出。

正文：
${chapter.content.slice(0, 8000)}

输出格式：
{
  "characterChanges": [{"characterName": "角色名", "change": "变化描述"}],
  "worldFacts": [{"fact": "新发现的世界事实"}],
  "newHooks": [{"hook": "新埋设的伏笔"}],
  "summary": "一句话总结本章",
  "chapterSummary": "详细章节摘要（200字以内）"
}`;

      const result = await model.generate(extractPrompt);
      const extracted = safeJson<ExtractOutput>(result.text, {
        characterChanges: [], worldFacts: [], newHooks: [],
        summary: "抽取失败", chapterSummary: ""
      });

      await prisma.$transaction(async (tx: Tx) => {
        // 写入前先读取现有记忆，用于去重与维护
        const existingMemories = await tx.projectMemory.findMany({
          where: { organizationId: job.organizationId, projectId: job.projectId },
          select: { content: true }
        });
        const existingContents = existingMemories.map((m) => m.content);
        const maintenance = { tx, organizationId: job.organizationId, projectId: job.projectId, chapterId: chapter.id };

        // 写入 proposed 状态的记忆
        for (const change of extracted.characterChanges) {
          if (!change.characterName) continue;
          const content = `${change.characterName}: ${change.change}`;
          if (isDuplicateContent(existingContents, content)) continue;
          // 角色状态只需反映最新：先淘汰该角色的更早状态
          await supersedeCharacterState({ ...maintenance, characterName: change.characterName });
          await tx.projectMemory.create({
            data: {
              organizationId: job.organizationId,
              projectId: job.projectId,
              memoryType: "character_state",
              scopeType: "chapter",
              scopeId: chapter.id,
              content,
              sourceChapterId: chapter.id,
              sourceJobId: job.id,
              status: "proposed",
              confidence: 70
            }
          });
        }

        for (const fact of extracted.worldFacts) {
          if (!fact.fact) continue;
          if (isDuplicateContent(existingContents, fact.fact)) continue;
          await tx.projectMemory.create({
            data: {
              organizationId: job.organizationId,
              projectId: job.projectId,
              memoryType: "world_fact",
              scopeType: "chapter",
              scopeId: chapter.id,
              content: fact.fact,
              sourceChapterId: chapter.id,
              sourceJobId: job.id,
              status: "proposed",
              confidence: 70
            }
          });
        }

        for (const hook of extracted.newHooks) {
          if (!hook.hook) continue;
          const content = `[新伏笔] ${hook.hook}`;
          if (isDuplicateContent(existingContents, content)) continue;
          await tx.projectMemory.create({
            data: {
              organizationId: job.organizationId,
              projectId: job.projectId,
              memoryType: "hook_status",
              scopeType: "chapter",
              scopeId: chapter.id,
              content,
              sourceChapterId: chapter.id,
              sourceJobId: job.id,
              status: "proposed",
              confidence: 60
            }
          });
        }

        if (extracted.chapterSummary) {
          // 章节摘要是事实性低风险内容：直接 accept，并把同章旧摘要淘汰。
          // 否则摘要在 proposed 里堆积，永远进不了上下文（生成只读 accepted）。
          await maintainChapterSummary(maintenance);
          await tx.projectMemory.create({
            data: {
              organizationId: job.organizationId,
              projectId: job.projectId,
              memoryType: "chapter_summary",
              scopeType: "chapter",
              scopeId: chapter.id,
              content: extracted.chapterSummary,
              contentJson: { title: chapter.title, chapterNo: chapter.chapterNo },
              sourceChapterId: chapter.id,
              sourceJobId: job.id,
              status: "accepted",
              confidence: 85
            }
          });
        }

        // accepted 的角色状态超过上限时淘汰最旧的，防止上下文预算被旧状态挤占
        const evictIds = await enforceCharacterStateQuota({
          ...maintenance,
          keep: MAX_ACCEPTED_CHARACTER_STATES_PER_PROJECT
        });
        if (evictIds.length > 0) {
          await tx.projectMemory.updateMany({
            where: { id: { in: evictIds } },
            data: { status: "superseded" }
          });
        }

        const now = new Date();
        await tx.generationStep.create({
          data: {
            organizationId: job.organizationId,
            jobId: job.id,
            stepKey: "extract_memory",
            status: "SUCCEEDED",
            startedAt: now,
            finishedAt: now,
            outputPreview: extracted.summary,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens
          }
        });

        await tx.generationJob.update({
          where: { id: job.id },
          data: {
            status: "SUCCEEDED",
            progress: "100",
            finishedAt: new Date(),
            output: {
              chapterId: chapter.id,
              characterChanges: extracted.characterChanges.length,
              worldFacts: extracted.worldFacts.length,
              newHooks: extracted.newHooks.length,
              summary: extracted.summary
            }
          }
        });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "extract memory failed";
      console.error(`[extract-memory] failed for job ${job.id}: ${message}`);
      throw error;
    }
  };
}

function resolveChapterId(job: GenerationJob): string | null {
  if (job.targetEntityType === "CHAPTER" && job.targetEntityId) return job.targetEntityId;
  const input = (job.input ?? {}) as { chapterId?: unknown };
  return typeof input.chapterId === "string" && input.chapterId.length > 0 ? input.chapterId : null;
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}
