import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { createFakeModel } from "./fake-model";
import { commitFinalize } from "./generate-chapter-handler";
import { buildContinuePrompt, normalizeTargetLength, stripCodeFence, TAIL_CONTEXT_CHARS } from "./continue-chapter-handler";
import type { GenerationJob } from "../poll";

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

interface BatchContinueInput {
  chapterId?: unknown;
  chapterCount?: unknown;
  targetLength?: unknown;
  instruction?: unknown;
}

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE",
  EMPTY_OUTPUT: "EMPTY_OUTPUT",
  BATCH_ABORTED: "BATCH_ABORTED"
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
 * 每章单独 commitFinalize 落一个版本，job.progress 实时上报进度。
 * 中途失败时已完成章节保留，job 定稿 FAILED 并注明完成到第几章。
 */
export function createBatchContinueHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
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

    const chapter0 = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, projectId: true, organizationId: true, title: true }
    });
    if (!chapter0) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, `章节 ${chapterId} 不存在或不属于当前项目`);
      return;
    }

    let totalAddedChars = 0;
    let completed = 0;

    for (let i = 0; i < chapterCount; i += 1) {
      // 每章前重读章节，拿到上一轮追加后的最新正文
      const chapter = await prisma.chapter.findFirst({
        where: { id: chapterId, organizationId: job.organizationId, deletedAt: null },
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
      const result = await model.generate(prompt);
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

      await commitFinalize({
        prisma,
        job,
        chapter,
        finalContent,
        wordCount: computeWordCount(finalContent),
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: 0,
          modelName,
          billingSource
        }
      });

      totalAddedChars += continuation.length;
      completed = i + 1;
      // 实时进度：前端轮询可见
      await prisma.generationJob.update({
        where: { id: job.id },
        data: { progress: String(Math.round((completed / chapterCount) * 100)) }
      });
    }

    await updateJobStatus({
      jobId: job.id,
      status: "SUCCEEDED",
      output: {
        mode: "BATCH_CONTINUE",
        requestedChapters: chapterCount,
        completedChapters: completed,
        addedChars: totalAddedChars
      }
    });
  };
}
