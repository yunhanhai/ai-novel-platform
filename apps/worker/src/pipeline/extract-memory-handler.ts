import type { PrismaClient } from "@ai-novel/db";
import { createFakeModel } from "./fake-model";
import { recordModelUsage } from "./usage-recorder";
import { persistExtractedMemories } from "./extracted-memory-store";
import { parseExtraction, InvalidExtractionOutputError } from "./extraction-output";
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
  INVALID_MODEL_OUTPUT: "INVALID_MODEL_OUTPUT",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ExtractedMemoryStats {
  characterChanges: number;
  worldFacts: number;
  newHooks: number;
  summary: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const EXTRACT_PROMPT_PREFIX = "你是小说记忆抽取器。分析本章正文，提取需要记录的信息。以 JSON 格式输出。保留人物推测、待核信息与已证实事实的区别，禁止把推测升级成世界事实，也不得新增正文之外的事件或背景。";
const EXTRACT_PROMPT_SCHEMA = `{
  "characterChanges": [{"characterName": "角色名", "change": "变化描述"}],
  "worldFacts": [{"fact": "新发现的世界事实"}],
  "newHooks": [{"hook": "新埋设的伏笔"}],
  "summary": "一句话总结本章",
  "chapterSummary": "详细章节摘要（200字以内）"
}`;

function buildExtractPrompt(content: string): string {
  return `${EXTRACT_PROMPT_PREFIX}

正文：
${content.slice(0, 8000)}

输出格式：
${EXTRACT_PROMPT_SCHEMA}`;
}

/**
 * 记忆抽取核心：解析正文 → 调模型 → 按维护规则落库。
 * 不碰 job 状态与 generationStep——独立任务与批量连更的每章钩子共用，
 * 由调用方决定如何记录步骤与定稿。
 */
export async function extractMemoriesForChapter(params: {
  prisma: PrismaClient;
  model: FakeModel;
  job: GenerationJob;
  chapter: { id: string; content: string; title: string; chapterNo: number };
  onPersisted?: (tx: Tx, stats: ExtractedMemoryStats) => Promise<void>;
}): Promise<ExtractedMemoryStats> {
  const { prisma, model, job, chapter } = params;

  const started = Date.now();
  const result = await model.generate(buildExtractPrompt(chapter.content), { responseFormat: "json_object" });
  const latencyMs = Date.now() - started;
  await recordModelUsage({ prisma, job, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });
  const extracted = parseExtraction(result.text);
  if (!extracted) throw new InvalidExtractionOutputError();
  const stats = {
    characterChanges: extracted.characterChanges.length, worldFacts: extracted.worldFacts.length,
    newHooks: extracted.newHooks.length, summary: extracted.summary,
    inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs
  };
  await prisma.$transaction(async (tx: Tx) => {
    await persistExtractedMemories({ tx, job, chapter, extracted });
    if (params.onPersisted) await params.onPersisted(tx, stats);
  });

  return stats;
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
    if (!chapter || !chapter.content?.trim()) {
      await updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: "CHAPTER_NOT_FOUND", errorMessage: "章节不存在或正文为空" });
      return;
    }

    const step = await prisma.generationStep.create({
      data: { organizationId: job.organizationId, jobId: job.id, stepKey: "extract_memory", status: "RUNNING", startedAt: new Date(), promptSnapshot: buildExtractPrompt(chapter.content).slice(0, 4000) },
      select: { id: true }
    });
    try {
      await extractMemoriesForChapter({ prisma, model, job, chapter, onPersisted: async (tx, stats) => {
        await tx.generationStep.update({ where: { id: step.id }, data: {
          status: "SUCCEEDED", finishedAt: new Date(), outputPreview: stats.summary,
          inputTokens: stats.inputTokens, outputTokens: stats.outputTokens, latencyMs: stats.latencyMs
        } });
        await tx.generationJob.update({ where: { id: job.id }, data: {
          status: "SUCCEEDED", progress: "100", finishedAt: new Date(),
          output: { chapterId: chapter.id, characterChanges: stats.characterChanges, worldFacts: stats.worldFacts, newHooks: stats.newHooks, summary: stats.summary }
        } });
      } });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "extract memory failed";
      try { await prisma.generationStep.update({ where: { id: step.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: "记忆抽取未完成，原有记忆未修改" } }); }
      catch { /* Keep the original failure for poll classification. */ }
      if (error instanceof InvalidExtractionOutputError) {
        await fail(job.id, ERROR_CODES.INVALID_MODEL_OUTPUT, "模型未返回完整的记忆 JSON，原有记忆未修改");
        return;
      }
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
