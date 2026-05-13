import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { getMethodologyTemplate, type MethodType, type MethodologyTemplate } from "@ai-novel/shared/methodology/templates";
import { createFakeModel } from "./fake-model";
import { runChapterPipeline } from "./chapter-pipeline";
import type { GenerationJob } from "../poll";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type FakeModel = ReturnType<typeof createFakeModel>;

export const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  HANDLER_ERROR: "HANDLER_ERROR",
  FINALIZE_FAILED: "FINALIZE_FAILED",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

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

interface ChapterRef {
  id: string;
  projectId: string;
  organizationId: string;
}

export function createGenerateChapterHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const chapterId = resolveChapterId(job);
    if (!chapterId) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "无法从 job target 或 input 解析 chapterId");
      return;
    }

    const chapter = await loadChapter(prisma, chapterId, job);
    if (!chapter) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, `章节 ${chapterId} 不存在或与 job projectId 不一致`);
      return;
    }

    // 模型解析：优先 resolveModel，其次 injected model，最后失败
    let model = builtinModel;
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
      } else if (!deps.model) {
        // resolveModel 返回 null 且没有注入 fallback model → 无可用模型
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "无法解析 ModelProfile 且未启用兜底模型");
        return;
      }
    }

    let finalContent: string;
    try {
      finalContent = await runPipelineForContent({ prisma, job, model, chapterId });
    } catch (error: unknown) {
      await fail(job.id, ERROR_CODES.HANDLER_ERROR, errorMessage(error, "pipeline failed"));
      return;
    }

    if (!finalContent) {
      await fail(job.id, ERROR_CODES.HANDLER_ERROR, "pipeline 未产出最终正文");
      return;
    }

    try {
      await commitFinalize({ prisma, job, chapter, finalContent, wordCount: computeWordCount(finalContent) });
    } catch (error: unknown) {
      await fail(job.id, ERROR_CODES.FINALIZE_FAILED, errorMessage(error, "finalize transaction failed"));
    }
  };
}

function resolveChapterId(job: GenerationJob): string | null {
  if (job.targetEntityType === "CHAPTER" && job.targetEntityId) {
    return job.targetEntityId;
  }
  const input = (job.input ?? {}) as { chapterId?: unknown };
  return typeof input.chapterId === "string" && input.chapterId.length > 0 ? input.chapterId : null;
}

async function loadChapter(prisma: PrismaClient, chapterId: string, job: GenerationJob): Promise<ChapterRef | null> {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, organizationId: job.organizationId, deletedAt: null },
    select: { id: true, projectId: true, organizationId: true }
  });
  return chapter && chapter.projectId === job.projectId ? chapter : null;
}

interface PipelineRunParams {
  prisma: PrismaClient;
  job: GenerationJob;
  model: FakeModel;
  chapterId: string;
}

interface MethodologyGuide {
  name: string;
  methodType: string;
  guideText: string;
  reviewCriteria?: string[];
}

async function loadActiveMethodology(
  prisma: PrismaClient,
  projectId: string
): Promise<MethodologyGuide | undefined> {
  const wm = (prisma as unknown as {
    writingMethodology?: {
      findFirst(args: unknown): Promise<{ name: string; methodType: string; reviewCriteria: unknown; outlineMetadata: unknown } | null>;
    };
  }).writingMethodology;
  if (!wm) return undefined;
  const record = await wm.findFirst({
    where: { projectId, isActive: true },
    select: { name: true, methodType: true, reviewCriteria: true, outlineMetadata: true }
  });
  if (!record) return undefined;

  if (!record) return undefined;

  let template: MethodologyTemplate | undefined;
  try {
    template = getMethodologyTemplate(record.methodType as MethodType);
  } catch {
    // custom 类型没有模板，使用 DB 记录自身的 reviewCriteria
  }

  const nodes = template?.outlineMetadata?.nodes ?? [];
  const guideText = nodes.length > 0
    ? nodes.map((n) => `[${n.level}] ${n.title}: ${n.summary}`).join("\n")
    : "";

  const reviewCriteria: string[] = template?.reviewCriteria
    ? [...template.reviewCriteria.structureChecks, ...template.reviewCriteria.pacingChecks, ...template.reviewCriteria.forbiddenMoves]
    : (Array.isArray(record.reviewCriteria) ? record.reviewCriteria as string[] : []);

  return {
    name: record.name,
    methodType: record.methodType,
    guideText,
    ...(reviewCriteria.length > 0 ? { reviewCriteria } : {})
  };
}

// runChapterPipeline 当前会调用 persistVersion 写入 ContentVersion，但本 handler 要求最终
// 正文与 version 必须在最终事务内提交。因此把 persistVersion 退化为只回传内容的 passthrough，
// 由 commitFinalize 在事务内创建真正的 ContentVersion。pipeline 返回的 v-final 占位一律忽略。
async function runPipelineForContent(params: PipelineRunParams): Promise<string> {
  const { prisma, job, model, chapterId } = params;

  // 提前查询方法论，以便同步注入 buildContext
  const methodologyGuide = await loadActiveMethodology(prisma, job.projectId);

  let finalContent = "";
  await runChapterPipeline({
    job,
    model,
    buildContext: () => ({
      prompt: `章节生成上下文（chapterId=${chapterId}）`,
      activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" },
      ...(methodologyGuide ? { methodologyGuide } : {})
    }),
    persistVersion: async ({ content }) => {
      finalContent = content;
      return { id: "pending", versionNo: 0 };
    },
    createStep: ({ stepKey }) =>
      prisma.generationStep.create({
        data: { organizationId: job.organizationId, jobId: job.id, stepKey, status: "PENDING" },
        select: { id: true }
      }),
    updateStep: async (update) => {
      await prisma.generationStep.update({
        where: { id: update.stepId },
        data: {
          status: update.status,
          finishedAt: new Date(),
          outputPreview: update.outputPreview,
          inputTokens: update.inputTokens,
          outputTokens: update.outputTokens,
          latencyMs: update.latencyMs
        }
      });
    }
  });
  return finalContent;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface CommitParams {
  prisma: PrismaClient;
  job: GenerationJob;
  chapter: ChapterRef;
  finalContent: string;
  wordCount: number;
}

interface FinalOutput {
  chapterId: string;
  versionId: string;
  versionNo: number;
  wordCount: number;
}

export async function commitFinalize(params: CommitParams): Promise<FinalOutput> {
  const { prisma, job, chapter, finalContent, wordCount } = params;

  return prisma.$transaction(async (tx: Tx) => {
    await assertChapterStillValid(tx, chapter, job);
    const nextVersionNo = await pickNextVersionNo(tx, chapter.id);
    const finishedAt = new Date();

    await tx.chapter.update({
      where: { id: chapter.id },
      data: {
        content: finalContent,
        wordCount,
        updatedById: job.userId,
        lastGeneratedJobId: job.id
      }
    });

    const version = await tx.contentVersion.create({
      data: {
        organizationId: job.organizationId,
        projectId: chapter.projectId,
        entityType: "CHAPTER",
        entityId: chapter.id,
        versionNo: nextVersionNo,
        content: finalContent,
        source: "AI",
        generationJobId: job.id,
        createdById: job.userId
      },
      select: { id: true, versionNo: true }
    });

    const output = {
      chapterId: chapter.id,
      versionId: version.id,
      versionNo: version.versionNo,
      wordCount
    };

    await tx.generationStep.create({
      data: {
        organizationId: job.organizationId,
        jobId: job.id,
        stepKey: "finalize",
        status: "SUCCEEDED",
        startedAt: finishedAt,
        finishedAt
      }
    });

    await tx.generationJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", progress: "100", finishedAt, output }
    });

    return output;
  });
}

async function assertChapterStillValid(tx: Tx, chapter: ChapterRef, job: GenerationJob): Promise<void> {
  const reread = await tx.chapter.findFirst({
    where: { id: chapter.id, organizationId: job.organizationId, deletedAt: null },
    select: { id: true, projectId: true }
  });
  if (!reread || reread.projectId !== job.projectId) {
    throw new Error("chapter 在事务内重新校验失败");
  }
}

async function pickNextVersionNo(tx: Tx, chapterId: string): Promise<number> {
  const last = await tx.contentVersion.findFirst({
    where: { entityType: "CHAPTER", entityId: chapterId },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true }
  });
  return (last?.versionNo ?? 0) + 1;
}
