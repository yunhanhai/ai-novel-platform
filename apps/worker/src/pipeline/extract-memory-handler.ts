import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { createFakeModel } from "./fake-model";
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
        // 写入 proposed 状态的记忆
        for (const change of extracted.characterChanges) {
          if (!change.characterName) continue;
          await tx.projectMemory.create({
            data: {
              organizationId: job.organizationId,
              projectId: job.projectId,
              memoryType: "character_state",
              scopeType: "chapter",
              scopeId: chapter.id,
              content: `${change.characterName}: ${change.change}`,
              sourceChapterId: chapter.id,
              sourceJobId: job.id,
              status: "proposed",
              confidence: 70
            }
          });
        }

        for (const fact of extracted.worldFacts) {
          if (!fact.fact) continue;
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
          await tx.projectMemory.create({
            data: {
              organizationId: job.organizationId,
              projectId: job.projectId,
              memoryType: "hook_status",
              scopeType: "chapter",
              scopeId: chapter.id,
              content: `[新伏笔] ${hook.hook}`,
              sourceChapterId: chapter.id,
              sourceJobId: job.id,
              status: "proposed",
              confidence: 60
            }
          });
        }

        if (extracted.chapterSummary) {
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
              status: "proposed",
              confidence: 85
            }
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
