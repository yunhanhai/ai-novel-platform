import type { PrismaClient, Prisma } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { buildContextPacket } from "@ai-novel/shared/context-composer/build-context-packet";
import { normalizeContextOptions, resolveTokenBudget } from "@ai-novel/shared/context-composer/options";
import type { ContextOptions, NormalizedContextOptions } from "@ai-novel/shared/context-composer/types";
import { getMethodologyTemplate, type MethodType, type MethodologyTemplate } from "@ai-novel/shared/methodology/templates";
import { normalizeQualityMode, normalizePerformanceBudget } from "@ai-novel/shared/generation/performance";
import type { PerformanceSummary, PerformanceBudgetInput } from "@ai-novel/shared/generation/performance";
import { createFakeModel } from "./fake-model";
import { runChapterPipeline } from "./chapter-pipeline";
import type { GenerationJob } from "../poll";
import type { RuntimeModel } from "../model-runtime";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type FakeModel = ReturnType<typeof createFakeModel>;
type BillingSource = "USER_KEY" | "PLATFORM";

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
  resolveModel?: (job: GenerationJob) => Promise<RuntimeModel | null>;
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
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "Unable to resolve chapterId from job target or input");
      return;
    }

    const chapter = await loadChapter(prisma, chapterId, job);
    if (!chapter) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, `Chapter ${chapterId} not found or does not belong to the job project`);
      return;
    }

    let model = builtinModel;
    let modelName = "fake-model";
    let billingSource: BillingSource = "PLATFORM";
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
        modelName = resolved.modelName;
        billingSource = resolved.billingSource;
      } else if (!deps.model) {
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "Unable to resolve ModelProfile and no fallback model is configured");
        return;
      }
    }

    let pipelineResult: PipelineRunResult;
    try {
      pipelineResult = await runPipelineForContentWithContext({ prisma, job, model, chapterId });
    } catch (error: unknown) {
      console.error(`[generate-chapter] pipeline failed for job ${job.id}: ${errorMessage(error, "pipeline failed")}`);
      throw error;
    }

    if (!pipelineResult.content) {
      await fail(job.id, ERROR_CODES.HANDLER_ERROR, "pipeline did not produce final content");
      return;
    }

    try {
      const finalOutput = await commitFinalize({
        prisma,
        job,
        chapter,
        finalContent: pipelineResult.content,
        wordCount: computeWordCount(pipelineResult.content),
        contextSummary: pipelineResult.contextSummary,
        performanceSummary: pipelineResult.performanceSummary,
        usage: { ...pipelineResult.usage, modelName, billingSource }
      });

      if (pipelineResult.performanceSummary.qualityMode === "deep") {
        await enqueueDeepDiagnostic({ prisma, job, chapterId: chapter.id, finalOutput });
      }
    } catch (error: unknown) {
      console.error(`[generate-chapter] finalize failed for job ${job.id}: ${errorMessage(error, "finalize transaction failed")}`);
      throw error;
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

interface PipelineRunResult {
  content: string;
  contextSummary: ContextSummary;
  usage: UsageTotals;
  performanceSummary: PerformanceSummary;
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

interface ContextSummary {
  [key: string]: string | number;
  budgetPreset: NormalizedContextOptions["budgetPreset"];
  includedCount: number;
  trimmedCount: number;
  forcedCount: number;
  excludedCount: number;
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
    // custom 绫诲瀷娌℃湁妯℃澘锛屼娇鐢?DB 璁板綍鑷韩鐨?reviewCriteria
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

async function runPipelineForContentWithContext(params: PipelineRunParams): Promise<PipelineRunResult> {
  const { prisma, job, model, chapterId } = params;
  const methodologyGuide = await loadActiveMethodology(prisma, job.projectId);
  const contextOptions = normalizeContextOptions(readContextOptions(job));
  const context = await buildWorkerContextPacket({ prisma, job, chapterId, methodologyGuide, contextOptions });

  const performanceInput = (job.input ?? {}) as { qualityMode?: unknown; performanceBudget?: PerformanceBudgetInput };
  const qualityMode = normalizeQualityMode(performanceInput.qualityMode);
  const budget = normalizePerformanceBudget(qualityMode, performanceInput.performanceBudget);

  let finalContent = "";
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const pipeline = await runChapterPipeline({
    job,
    model,
    performance: { qualityMode, budget },
    buildContext: () => context,
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
      usage.inputTokens += update.inputTokens ?? 0;
      usage.outputTokens += update.outputTokens ?? 0;
      usage.latencyMs += update.latencyMs ?? 0;
      await prisma.generationStep.update({
        where: { id: update.stepId },
        data: {
          status: update.status,
          finishedAt: new Date(),
          outputPreview: update.outputPreview,
          promptSnapshot: update.promptSnapshot,
          inputTokens: update.inputTokens,
          outputTokens: update.outputTokens,
          latencyMs: update.latencyMs
        }
      });
    }
  });

  return {
    content: finalContent,
    contextSummary: {
      budgetPreset: contextOptions.budgetPreset,
      includedCount: context.assets.included.length,
      trimmedCount: context.assets.trimmed.length,
      forcedCount: context.assets.forced.length,
      excludedCount: context.assets.excluded.length
    },
    usage,
    performanceSummary: pipeline.performanceSummary
  };
}

function readContextOptions(job: GenerationJob): ContextOptions | undefined {
  const input = job.input as { contextOptions?: ContextOptions } | null | undefined;
  return input?.contextOptions;
}

async function buildWorkerContextPacket(params: {
  prisma: PrismaClient;
  job: GenerationJob;
  chapterId: string;
  methodologyGuide?: MethodologyGuide;
  contextOptions: NormalizedContextOptions;
}) {
  const { prisma, job, chapterId, methodologyGuide, contextOptions } = params;
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, organizationId: job.organizationId, deletedAt: null },
    select: {
      id: true,
      chapterNo: true,
      title: true,
      outlineSummary: true,
      project: { select: { title: true, styleBrief: true } }
    }
  }) as WorkerChapter | null;

  const delegates = prisma as unknown as WorkerAssetDelegates;
  const [characters, worldItems, plotThreads, memories, styleProfile] = await Promise.all([
    delegates.character?.findMany({ where: { organizationId: job.organizationId, projectId: job.projectId, status: "active", deletedAt: null }, orderBy: { createdAt: "asc" } }) ?? Promise.resolve([]),
    delegates.worldItem?.findMany({ where: { organizationId: job.organizationId, projectId: job.projectId, status: "active", deletedAt: null }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }) ?? Promise.resolve([]),
    delegates.plotThread?.findMany({ where: { organizationId: job.organizationId, projectId: job.projectId, deletedAt: null, status: { in: ["planted", "progressing", "deferred"] } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }) ?? Promise.resolve([]),
    delegates.projectMemory?.findMany({ where: { organizationId: job.organizationId, projectId: job.projectId, status: "accepted" }, orderBy: { createdAt: "desc" }, take: 20 }) ?? Promise.resolve([]),
    delegates.styleProfile?.findFirst({ where: { organizationId: job.organizationId, projectId: job.projectId, isActive: true }, orderBy: { updatedAt: "desc" } }) ?? Promise.resolve(null)
  ]);

  return buildContextPacket({
    projectId: job.projectId,
    projectTitle: chapter?.project?.title ?? job.projectId,
    styleBrief: chapter?.project?.styleBrief ?? undefined,
    currentChapter: {
      id: chapter?.id ?? chapterId,
      chapterNo: chapter?.chapterNo ?? 0,
      title: chapter?.title ?? chapterId,
      outlineSummary: chapter?.outlineSummary ?? undefined
    },
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
      roleType: character.roleType,
      personality: character.personality ?? undefined,
      speechPattern: character.speechPattern ?? undefined,
      content: compactLines([character.motivation ?? "", character.appearance ?? "", character.arc ?? "", character.constraints ?? ""])
    })),
    worldItems: worldItems.map((item) => ({
      id: item.id,
      name: item.name,
      itemType: item.itemType,
      content: compactLines([item.summary ?? "", item.detail ?? "", item.constraints ?? ""]),
      activationKeywords: asStringArray(item.activationKeywords, [item.name])
    })),
    plotThreads: plotThreads.map((thread) => ({
      id: thread.id,
      threadType: thread.threadType,
      title: thread.title,
      content: thread.description ?? "",
      status: thread.status
    })),
    recentMemories: memories.map((memory) => ({
      memoryType: memory.memoryType,
      content: memory.content,
      scopeType: memory.scopeType,
      sourceChapterId: memory.sourceChapterId
    })),
    tokenBudget: resolveTokenBudget(contextOptions.budgetPreset),
    styleGuide: styleProfile ? {
      brief: styleProfile.styleBrief ?? undefined,
      banned: asStringArray(styleProfile.bannedWords),
      preferred: asStringArray(styleProfile.preferredWords),
      sentenceTarget: parseSentenceTarget(styleProfile.sentenceLengthProfile)
    } : undefined,
    ...(methodologyGuide ? { methodologyGuide } : {}),
    contextOptions
  });
}

async function runPipelineForContent(params: PipelineRunParams): Promise<string> {
  const { prisma, job, model, chapterId } = params;

  // 鎻愬墠鏌ヨ鏂规硶璁猴紝浠ヤ究鍚屾娉ㄥ叆 buildContext
  const methodologyGuide = await loadActiveMethodology(prisma, job.projectId);

  let finalContent = "";
  await runChapterPipeline({
    job,
    model,
    buildContext: () => ({
      prompt: `Chapter generation context (chapterId=${chapterId})`,
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
          promptSnapshot: update.promptSnapshot,
          inputTokens: update.inputTokens,
          outputTokens: update.outputTokens,
          latencyMs: update.latencyMs
        }
      });
    }
  });
  return finalContent;
}

interface WorkerChapter {
  id: string;
  chapterNo: number;
  title: string;
  outlineSummary: string | null;
  project?: { title: string; styleBrief: string | null };
}

interface WorkerAssetDelegates {
  character?: { findMany(args: unknown): Promise<WorkerCharacter[]> };
  worldItem?: { findMany(args: unknown): Promise<WorkerWorldItem[]> };
  plotThread?: { findMany(args: unknown): Promise<WorkerPlotThread[]> };
  projectMemory?: { findMany(args: unknown): Promise<WorkerMemory[]> };
  styleProfile?: { findFirst(args: unknown): Promise<WorkerStyleProfile | null> };
}

interface WorkerCharacter { id: string; name: string; roleType: string; personality: string | null; speechPattern: string | null; motivation: string | null; appearance: string | null; arc: string | null; constraints: string | null; }
interface WorkerWorldItem { id: string; name: string; itemType: string; summary: string | null; detail: string | null; constraints: string | null; activationKeywords: unknown; }
interface WorkerPlotThread { id: string; threadType: string; title: string; description: string | null; status: string; }
interface WorkerMemory { memoryType: string; content: string; scopeType: string; sourceChapterId: string | null; }
interface WorkerStyleProfile { styleBrief: string | null; bannedWords: unknown; preferredWords: unknown; sentenceLengthProfile: unknown; }

function compactLines(values: string[]): string {
  return values.filter((value) => value.trim().length > 0).join("\n");
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function parseSentenceTarget(value: unknown): { avg: number; min: number; max: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.avg !== "number") return undefined;
  return {
    avg: record.avg,
    min: typeof record.min === "number" ? record.min : record.avg,
    max: typeof record.max === "number" ? record.max : record.avg
  };
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
  contextSummary?: ContextSummary;
  performanceSummary?: PerformanceSummary;
  usage?: UsageRecord;
}

interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  modelName: string;
  billingSource: BillingSource;
}

interface FinalOutput {
  chapterId: string;
  versionId: string;
  versionNo: number;
  wordCount: number;
  contextSummary?: ContextSummary;
  performanceSummary?: PerformanceSummary;
}

export async function commitFinalize(params: CommitParams): Promise<FinalOutput> {
  const { prisma, job, chapter, finalContent, wordCount, contextSummary, performanceSummary, usage } = params;

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
      wordCount,
      ...(contextSummary ? { contextSummary } : {}),
      ...(performanceSummary ? { performanceSummary } : {})
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
      data: { status: "SUCCEEDED", progress: "100", finishedAt, output: output as unknown as Prisma.InputJsonValue }
    });

    if (usage) {
      await tx.usageEvent.create({
        data: {
          organizationId: job.organizationId,
          userId: job.userId,
          projectId: chapter.projectId,
          generationJobId: job.id,
          modelName: usage.modelName,
          billingSource: usage.billingSource,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: usage.latencyMs
        }
      });
    }

    return output;
  });
}

async function enqueueDeepDiagnostic(params: {
  prisma: PrismaClient;
  job: GenerationJob;
  chapterId: string;
  finalOutput: FinalOutput;
}): Promise<void> {
  const { prisma, job, chapterId, finalOutput } = params;
  try {
    await prisma.generationJob.create({
      data: {
        organizationId: job.organizationId,
        projectId: job.projectId,
        userId: job.userId,
        jobType: "DIAGNOSE_CHAPTER",
        targetEntityType: "CHAPTER",
        targetEntityId: chapterId,
        status: "QUEUED",
        progress: "0",
        input: {
          chapterId,
          parentJobId: job.id,
          qualityMode: "deep",
          performanceBudget: normalizePerformanceBudget("balanced", undefined)
        } as unknown as Prisma.InputJsonValue
      }
    });
  } catch (error: unknown) {
    // 诊断子任务入队失败不得回退已 SUCCEEDED 的父任务，仅在 output 追加告警（best-effort）
    const warning = errorMessage(error, "failed to enqueue diagnostic job");
    console.error(`[generate-chapter] deep diagnostic enqueue failed for job ${job.id}: ${warning}`);
    try {
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          output: {
            ...finalOutput,
            diagnosticWarning: warning
          } as unknown as Prisma.InputJsonValue
        }
      });
    } catch {
      // 二次失败忽略：父任务已成功落库，诊断仅为增强能力
    }
  }
}

async function assertChapterStillValid(tx: Tx, chapter: ChapterRef, job: GenerationJob): Promise<void> {
  const reread = await tx.chapter.findFirst({
    where: { id: chapter.id, organizationId: job.organizationId, deletedAt: null },
    select: { id: true, projectId: true }
  });
  if (!reread || reread.projectId !== job.projectId) {
    throw new Error("chapter 鍦ㄤ簨鍔″唴閲嶆柊鏍￠獙澶辫触");
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
