import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { createFakeModel } from "./fake-model";
import { commitFinalize } from "./generate-chapter-handler";
import { MAX_MEMORY_SOURCE_CHARS, MemorySourceTooLongError } from "./extract-memory-handler";
import { buildContinuePrompt, normalizeTargetLength, stripCodeFence, TAIL_CONTEXT_CHARS } from "./continue-chapter-handler";
import { BatchCheckpointConflict, lockBatchJob, readBatchCheckpoint, type BatchCheckpoint } from "./batch-checkpoint";
import type { GenerationJob } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;

type UpdateStatusFn = (params: {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  expectedAttemptCount?: number;
}) => Promise<unknown>;

type ExtractMemoriesFn = (params: {
  prisma: PrismaClient;
  model: FakeModel;
  job: GenerationJob;
  chapter: { id: string; content: string; title: string; chapterNo: number };
}) => Promise<unknown>;

interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
  // 每章续写落库后自动抽取记忆（保持记忆链最新，让后续章节基于新记忆生成）。
  // 抽取失败不中断连更——正文是主产物，记忆是辅助。
  extractMemories?: ExtractMemoriesFn;
}

interface BatchContinueInput {
  chapterId?: unknown;
  chapterCount?: unknown;
  targetLength?: unknown;
  instruction?: unknown;
  extractMemory?: unknown;
}

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE",
  EMPTY_OUTPUT: "EMPTY_OUTPUT",
  BATCH_ABORTED: "BATCH_ABORTED",
  BATCH_CHECKPOINT_INVALID: "BATCH_CHECKPOINT_INVALID"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const MIN_CHAPTER_COUNT = 1;
const MAX_CHAPTER_COUNT = 10;

export function normalizeChapterCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < MIN_CHAPTER_COUNT) return 1;
  return Math.min(Math.round(parsed), MAX_CHAPTER_COUNT);
}

/**
 * 自动连更：一个 job 顺序续写 N 章。
 * 每章前重新读取章节内容（拿到上一轮追加后的最新正文），
 * 每轮正文、版本与断点同事务保存；只有全部轮次结束才完成任务。
 * 临时错误由 poll 重试，使用持久断点继续，不重放已保存的正文。
 */
export function createBatchContinueHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  return async function handle(job: GenerationJob): Promise<void> {
    const fail = (jobId: string, code: ErrorCode, message: string) =>
      updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message, expectedAttemptCount: job.attemptCount ?? 1 });
    const input = (job.input ?? {}) as BatchContinueInput;
    const chapterId =
      typeof input.chapterId === "string" && input.chapterId.length > 0
        ? input.chapterId
        : job.targetEntityType === "CHAPTER" && typeof job.targetEntityId === "string"
          ? job.targetEntityId
          : null;
    if (!chapterId) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "无法从任务目标解析 chapterId");
      return;
    }

    const chapterCount = normalizeChapterCount(input.chapterCount);
    const targetLength = normalizeTargetLength(input.targetLength);
    const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";

    const chapter0 = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, projectId: true, organizationId: true, title: true }
    });
    if (!chapter0) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, `章节 ${chapterId} 不存在或不属于当前项目`);
      return;
    }

    const persisted = await prisma.generationJob.findUnique({ where: { id: job.id }, select: { status: true, output: true } });
    if (!persisted || persisted.status === "CANCELLED" || persisted.status === "SUCCEEDED") return;
    let checkpoint: BatchCheckpoint;
    try {
      const saved = readBatchCheckpoint(persisted.output, chapterId, chapterCount);
      const versions = await prisma.contentVersion.count({ where: { organizationId: job.organizationId, projectId: job.projectId, entityType: "CHAPTER", entityId: chapterId, generationJobId: job.id, source: "AI" } });
      if ((!saved && versions > 0) || (saved && versions !== saved.completedChapters)) {
        throw new BatchCheckpointConflict("已有正文版本与批量进度不一致，请核对已保存内容后新建剩余任务，禁止从头重放");
      }
      checkpoint = saved ?? { mode: "BATCH_CONTINUE", checkpointVersion: 1, chapterId, requestedChapters: chapterCount,
        completedChapters: 0, addedChars: 0, memoryExtractedChapters: 0, generationWarnings: [] };
    } catch (error) {
      if (!(error instanceof BatchCheckpointConflict)) throw error;
      await fail(job.id, ERROR_CODES.BATCH_CHECKPOINT_INVALID, error.message);
      return;
    }
    let completed = checkpoint.completedChapters;
    let totalAddedChars = checkpoint.addedChars;
    let memoryExtractedChapters = checkpoint.memoryExtractedChapters;
    let generationWarnings = [...checkpoint.generationWarnings];
    if (completed === chapterCount) {
      await finishBatch();
      return;
    }

    let model = builtinModel;
    let modelName = "fake-model";
    let billingSource: "PLATFORM" | "USER_KEY" = "PLATFORM";
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
        const meta = resolved as unknown as { modelName?: string; billingSource?: "PLATFORM" | "USER_KEY" };
        modelName = meta.modelName ?? modelName;
        billingSource = meta.billingSource ?? billingSource;
      } else if (!deps.model) {
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "无法解析 ModelProfile 且未配置兜底模型");
        return;
      }
    }

    // 默认开启：连更的价值之一就是自动维护记忆链，让后续章节基于最新记忆生成。
    // 显式传 extractMemory: false 可关闭（每章会多一次模型调用）。
    const wantExtract = input.extractMemory !== false && Boolean(deps.extractMemories);

    for (let i = completed; i < chapterCount; i += 1) {
      // 用户可能在上一章生成期间点了「停止」：每章开始前检查一次，
      // 已完成的章节保留，安静退出（状态已是 CANCELLED，不能再覆盖）。
      const current = await prisma.generationJob.findUnique({
        where: { id: job.id },
        select: { status: true }
      });
      if (current?.status === "CANCELLED") {
        console.log(`[batch-continue] job ${job.id} cancelled by user after ${completed} chapters`);
        return;
      }

      // 每章前重读章节，拿到上一轮追加后的最新正文
      const chapter = await prisma.chapter.findFirst({
        where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
        select: { id: true, projectId: true, organizationId: true, content: true, title: true }
      });
      if (!chapter) {
        await fail(
          job.id,
          ERROR_CODES.BATCH_ABORTED,
          `第 ${i + 1} 章开始前章节已不存在（已完成 ${completed} 章）`
        );
        return;
      }

      const existing = chapter.content ?? "";
      const prompt = buildContinuePrompt(
        existing.slice(-TAIL_CONTEXT_CHARS),
        targetLength,
        instruction || undefined
      );
      const started = Date.now();
      const result = await model.generate(prompt);
      const latencyMs = Date.now() - started;
      const continuation = stripCodeFence(result.text);
      if (!continuation) {
        await fail(
          job.id,
          ERROR_CODES.BATCH_ABORTED,
          `第 ${i + 1} 章模型未返回文本，已停止（已完成 ${completed} 章）`
        );
        return;
      }

      const separator = existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
      const finalContent = `${existing}${separator}${continuation}`;

      const pendingWarning = { stepKey: "extract_memory", code: "MEMORY_EXTRACTION_PENDING", message: `第${i + 1}轮正文已保存，记忆抽取尚未确认完成；如任务中断请单独重新抽取。` };
      const nextCheckpoint: BatchCheckpoint = { ...checkpoint, completedChapters: i + 1,
        addedChars: totalAddedChars + continuation.length, memoryExtractedChapters,
        generationWarnings: [...generationWarnings, ...(wantExtract ? [pendingWarning] : [])] };
      await commitFinalize({
        batchCheckpoint: nextCheckpoint,
        expectedContent: existing,
        prisma,
        job,
        chapter,
        finalContent,
        wordCount: computeWordCount(finalContent),
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs,
          modelName,
          billingSource
        }
      });

      checkpoint = nextCheckpoint;
      totalAddedChars = checkpoint.addedChars;
      completed = checkpoint.completedChapters;
      generationWarnings = [...checkpoint.generationWarnings];

      // 每章落库后抽取记忆：后续章节生成时上下文里就有最新摘要与角色状态。
      // 抽取失败只告警，不中断连更——正文是主产物。
      if (wantExtract && deps.extractMemories) {
        let extractionSucceeded = false;
        let extractionWarning = pendingWarning;
        try {
          const fresh = await prisma.chapter.findFirst({
            where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
            select: { id: true, content: true, title: true, chapterNo: true }
          });
          if (fresh?.content) {
            await deps.extractMemories({ prisma, model, job, chapter: fresh });
            extractionSucceeded = true;
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(`[batch-continue] memory extraction failed for chapter ${chapterId}: ${msg}`);
          const tooLong = error instanceof MemorySourceTooLongError;
          extractionWarning = {
            stepKey: "extract_memory",
            code: tooLong ? "MEMORY_SOURCE_TOO_LONG" : "MEMORY_EXTRACTION_FAILED",
            message: tooLong
              ? `第${completed}轮正文已保存，但超过${MAX_MEMORY_SOURCE_CHARS}字，未抽取记忆；请拆章后重新抽取。`
              : `第${completed}轮正文已保存，但记忆抽取失败；请检查模型设置及来源正文后重新抽取。`
          };
        }
        generationWarnings = generationWarnings.filter(w => w !== pendingWarning);
        if (extractionSucceeded) memoryExtractedChapters += 1;
        else generationWarnings.push(extractionWarning);
        checkpoint = { ...checkpoint, memoryExtractedChapters, generationWarnings };
        await prisma.$transaction(async tx => {
          const locked = await lockBatchJob(tx, job);
          const saved = readBatchCheckpoint(locked.output, chapterId, chapterCount);
          if (locked.attemptCount !== (job.attemptCount ?? 1) || saved?.completedChapters !== completed || !["RUNNING", "CANCELLED"].includes(locked.status)) {
            throw new BatchCheckpointConflict("批量进度已变化，未覆盖其他轮次的抽取结果");
          }
          await tx.generationJob.update({ where: { id: job.id }, data: { output: { ...(locked.output as object), ...checkpoint } } });
        });
      }
    }

    await finishBatch();

    async function finishBatch() {
      await prisma.generationJob.updateMany({
        where: { id: job.id, organizationId: job.organizationId, projectId: job.projectId, status: "RUNNING", attemptCount: job.attemptCount ?? 1,
          output: { path: ["completedChapters"], equals: chapterCount } },
        data: { status: "SUCCEEDED", progress: "100", finishedAt: new Date(), errorCode: null, errorMessage: null }
      });
    }
  };
}
