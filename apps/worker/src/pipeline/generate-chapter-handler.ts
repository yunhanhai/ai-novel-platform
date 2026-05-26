import type { PrismaClient } from "@ai-novel/db";
import { createHash } from "node:crypto";
import {
  normalizePerformanceBudget,
  normalizeQualityMode,
  type PerformanceBudgetInput,
  type PerformanceSummary
} from "@ai-novel/shared/generation/performance";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { getMethodologyTemplate, type MethodType, type MethodologyTemplate } from "@ai-novel/shared/methodology/templates";
import { buildContextPacket, type MethodologyGuide, type StyleGuide } from "../context/build-context-packet";
import { deriveGenerationContextTokenBudget } from "../context/generation-context-budget";
import { createFakeModel } from "./fake-model";
import { runChapterPipeline } from "./chapter-pipeline";
import { readModelUsage, recordModelUsage } from "./usage-recorder";
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
  chapterNo?: number;
  title?: string;
  outlineSummary?: string | null;
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

    let pipelineResult: PipelineRunResult;
    try {
      pipelineResult = await runPipelineForContent({ prisma, job, model, chapterId });
    } catch (error: unknown) {
      await fail(job.id, ERROR_CODES.HANDLER_ERROR, errorMessage(error, "pipeline failed"));
      return;
    }

    if (!pipelineResult.content) {
      await fail(job.id, ERROR_CODES.HANDLER_ERROR, "pipeline 未产出最终正文");
      return;
    }

    try {
      const finalOutput = await commitFinalize({
        prisma,
        job,
        chapter,
        finalContent: pipelineResult.content,
        wordCount: computeWordCount(pipelineResult.content),
        performanceSummary: pipelineResult.performanceSummary
      });
      if (pipelineResult.performanceSummary.qualityMode === "deep") {
        await enqueueDeepDiagnostic({ prisma, job, chapter, finalOutput });
      }
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
    select: {
      id: true,
      projectId: true,
      organizationId: true,
      chapterNo: true,
      title: true,
      outlineSummary: true
    }
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
  performanceSummary: PerformanceSummary;
}

async function loadActiveMethodology(
  prisma: PrismaClient,
  projectId: string
): Promise<MethodologyGuide | undefined> {
  const wm = (prisma as unknown as {
    writingMethodology?: {
      findFirst(args: unknown): Promise<{ name: string; methodType: string; reviewCriteria: unknown; outlineMetadata: unknown; updatedAt?: Date | string | null } | null>;
    };
  }).writingMethodology;
  if (!wm) return undefined;
  const record = await wm.findFirst({
    where: { projectId, isActive: true },
    select: { name: true, methodType: true, reviewCriteria: true, outlineMetadata: true, updatedAt: true }
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
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    ...(reviewCriteria.length > 0 ? { reviewCriteria } : {})
  };
}

// runChapterPipeline 当前会调用 persistVersion 写入 ContentVersion，但本 handler 要求最终
// 正文与 version 必须在最终事务内提交。因此把 persistVersion 退化为只回传内容的 passthrough，
// 由 commitFinalize 在事务内创建真正的 ContentVersion。pipeline 返回的 v-final 占位一律忽略。
async function runPipelineForContent(params: PipelineRunParams): Promise<PipelineRunResult> {
  const { prisma, job, model, chapterId } = params;

  // 提前查询方法论，以便同步注入 buildContext
  const methodologyGuide = await loadActiveMethodology(prisma, job.projectId);
  const performance = readPerformanceConfig(job);
  const contextPacket = await loadGenerationContextPacket({
    prisma,
    job,
    chapterId,
    methodologyGuide,
    contextTokenBudget: deriveGenerationContextTokenBudget(performance)
  });

  let finalContent = "";
  const pipelineResult = await runChapterPipeline({
    job,
    model,
    buildContext: () => contextPacket,
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
    },
    recordModelUsage: (usage) =>
      recordModelUsage({
        prisma,
        job,
        usage: readModelUsage(model),
        ...usage
      }),
    performance
  });
  return {
    content: finalContent,
    performanceSummary: pipelineResult.performanceSummary
  };
}

interface GenerationContextLoadParams {
  prisma: PrismaClient;
  job: GenerationJob;
  chapterId: string;
  methodologyGuide?: MethodologyGuide;
  contextTokenBudget: number;
}

interface ProjectRecord {
  id: string;
  title: string;
  styleBrief?: string | null;
  updatedAt?: Date | string | null;
}

interface ChapterContextRecord {
  id: string;
  chapterNo: number;
  title: string;
  outlineSummary?: string | null;
  updatedAt?: Date | string | null;
}

interface CharacterRecord {
  id: string;
  name: string;
  roleType: string;
  personality?: string | null;
  speechPattern?: string | null;
  motivation?: string | null;
  arc?: string | null;
  constraints?: string | null;
  updatedAt?: Date | string | null;
}

interface WorldItemRecord {
  id: string;
  name: string;
  itemType: string;
  summary?: string | null;
  detail?: string | null;
  constraints?: string | null;
  activationKeywords?: unknown;
  updatedAt?: Date | string | null;
}

interface PlotThreadRecord {
  id: string;
  threadType: string;
  title: string;
  description?: string | null;
  status: string;
  updatedAt?: Date | string | null;
}

interface ProjectMemoryRecord {
  memoryType: string;
  content: string;
  scopeType: string;
  sourceChapterId?: string | null;
  updatedAt?: Date | string | null;
}

interface StyleProfileRecord {
  styleBrief?: string | null;
  bannedWords?: unknown;
  preferredWords?: unknown;
  sentenceLengthProfile?: unknown;
  updatedAt?: Date | string | null;
}

async function loadGenerationContextPacket(params: GenerationContextLoadParams) {
  const { prisma, job, chapterId, methodologyGuide, contextTokenBudget } = params;
  const delegates = prisma as unknown as GenerationContextDelegates;

  const [project, chapter, characters, worldItems, plotThreads, recentMemories, styleProfile] = await Promise.all([
    loadProjectForContext(delegates, job),
    loadChapterForContext(delegates, chapterId, job),
    loadCharactersForContext(delegates, job),
    loadWorldItemsForContext(delegates, job),
    loadPlotThreadsForContext(delegates, job),
    loadRecentMemoriesForContext(delegates, job),
    loadStyleProfileForContext(delegates, job)
  ]);

  return buildContextPacket({
    projectId: job.projectId,
    projectTitle: project?.title ?? job.projectId,
    ...(project?.styleBrief ? { styleBrief: project.styleBrief } : {}),
    currentChapter: {
      id: chapter?.id ?? chapterId,
      chapterNo: chapter?.chapterNo ?? 0,
      title: chapter?.title ?? chapterId,
      ...(chapter?.outlineSummary ? { outlineSummary: chapter.outlineSummary } : {})
    },
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
      roleType: character.roleType,
      ...(character.personality ? { personality: character.personality } : {}),
      ...(character.speechPattern ? { speechPattern: character.speechPattern } : {}),
      content: compactJoin([character.motivation, character.arc, character.constraints])
    })),
    worldItems: worldItems.map((item) => ({
      id: item.id,
      name: item.name,
      itemType: item.itemType,
      content: compactJoin([item.summary, item.detail, item.constraints]),
      activationKeywords: toStringArray(item.activationKeywords, [item.name])
    })),
    plotThreads: plotThreads.map((thread) => ({
      id: thread.id,
      threadType: thread.threadType,
      title: thread.title,
      content: thread.description ?? "",
      status: thread.status
    })),
    recentMemories: recentMemories.map((memory) => ({
      memoryType: memory.memoryType,
      content: memory.content,
      scopeType: memory.scopeType,
      ...(memory.sourceChapterId ? { sourceChapterId: memory.sourceChapterId } : {})
    })),
    tokenBudget: contextTokenBudget,
    contextOptionsHash: contextOptionsHash(job, contextTokenBudget),
    sourceUpdatedAt: latestTimestamp([
      project?.updatedAt,
      chapter?.updatedAt,
      ...characters.map((character) => character.updatedAt),
      ...worldItems.map((item) => item.updatedAt),
      ...plotThreads.map((thread) => thread.updatedAt),
      ...recentMemories.map((memory) => memory.updatedAt),
      styleProfile?.updatedAt,
      methodologyGuide?.updatedAt
    ]),
    ...(styleProfile ? { styleGuide: mapStyleGuide(styleProfile) } : {}),
    ...(methodologyGuide ? { methodologyGuide } : {})
  });
}

interface GenerationContextDelegates {
  project?: {
    findFirst(args: unknown): Promise<ProjectRecord | null>;
  };
  chapter?: {
    findFirst(args: unknown): Promise<ChapterContextRecord | null>;
  };
  character?: {
    findMany(args: unknown): Promise<CharacterRecord[]>;
  };
  worldItem?: {
    findMany(args: unknown): Promise<WorldItemRecord[]>;
  };
  plotThread?: {
    findMany(args: unknown): Promise<PlotThreadRecord[]>;
  };
  projectMemory?: {
    findMany(args: unknown): Promise<ProjectMemoryRecord[]>;
  };
  styleProfile?: {
    findFirst(args: unknown): Promise<StyleProfileRecord | null>;
  };
}

async function loadProjectForContext(delegates: GenerationContextDelegates, job: GenerationJob): Promise<ProjectRecord | null> {
  if (!delegates.project) return null;
  return delegates.project.findFirst({
    where: { id: job.projectId, organizationId: job.organizationId, deletedAt: null },
    select: { id: true, title: true, styleBrief: true, updatedAt: true }
  });
}

async function loadChapterForContext(
  delegates: GenerationContextDelegates,
  chapterId: string,
  job: GenerationJob
): Promise<ChapterContextRecord | null> {
  if (!delegates.chapter) return null;
  return delegates.chapter.findFirst({
    where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
    select: { id: true, chapterNo: true, title: true, outlineSummary: true, updatedAt: true }
  });
}

async function loadCharactersForContext(
  delegates: GenerationContextDelegates,
  job: GenerationJob
): Promise<CharacterRecord[]> {
  if (!delegates.character) return [];
  return delegates.character.findMany({
    where: { organizationId: job.organizationId, projectId: job.projectId, status: "active", deletedAt: null },
    orderBy: [{ roleType: "asc" }, { updatedAt: "desc" }],
    take: 80,
    select: {
      id: true,
      name: true,
      roleType: true,
      personality: true,
      speechPattern: true,
      motivation: true,
      arc: true,
      constraints: true,
      updatedAt: true
    }
  });
}

async function loadWorldItemsForContext(
  delegates: GenerationContextDelegates,
  job: GenerationJob
): Promise<WorldItemRecord[]> {
  if (!delegates.worldItem) return [];
  return delegates.worldItem.findMany({
    where: { organizationId: job.organizationId, projectId: job.projectId, status: "active", deletedAt: null },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    take: 120,
    select: {
      id: true,
      name: true,
      itemType: true,
      summary: true,
      detail: true,
      constraints: true,
      activationKeywords: true,
      updatedAt: true
    }
  });
}

async function loadPlotThreadsForContext(
  delegates: GenerationContextDelegates,
  job: GenerationJob
): Promise<PlotThreadRecord[]> {
  if (!delegates.plotThread) return [];
  return delegates.plotThread.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: job.projectId,
      deletedAt: null,
      status: { in: ["planted", "progressing", "deferred"] }
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    take: 80,
    select: { id: true, threadType: true, title: true, description: true, status: true, updatedAt: true }
  });
}

async function loadRecentMemoriesForContext(
  delegates: GenerationContextDelegates,
  job: GenerationJob
): Promise<ProjectMemoryRecord[]> {
  if (!delegates.projectMemory) return [];
  return delegates.projectMemory.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: job.projectId,
      status: { in: ["accepted", "proposed"] }
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    take: 60,
    select: { memoryType: true, content: true, scopeType: true, sourceChapterId: true, updatedAt: true }
  });
}

async function loadStyleProfileForContext(
  delegates: GenerationContextDelegates,
  job: GenerationJob
): Promise<StyleProfileRecord | null> {
  if (!delegates.styleProfile) return null;
  return delegates.styleProfile.findFirst({
    where: { organizationId: job.organizationId, projectId: job.projectId, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { styleBrief: true, bannedWords: true, preferredWords: true, sentenceLengthProfile: true, updatedAt: true }
  });
}

function mapStyleGuide(profile: StyleProfileRecord): StyleGuide {
  const guide: StyleGuide = {};
  if (profile.styleBrief) guide.brief = profile.styleBrief;
  const banned = toStringArray(profile.bannedWords);
  if (banned.length > 0) guide.banned = banned;
  const preferred = toStringArray(profile.preferredWords);
  if (preferred.length > 0) guide.preferred = preferred;
  const sentenceTarget = parseSentenceTarget(profile.sentenceLengthProfile);
  if (sentenceTarget) guide.sentenceTarget = sentenceTarget;
  return guide;
}

function parseSentenceTarget(value: unknown): StyleGuide["sentenceTarget"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  return typeof v.avg === "number" && typeof v.min === "number" && typeof v.max === "number"
    ? { avg: v.avg, min: v.min, max: v.max }
    : undefined;
}

function toStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function compactJoin(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join("\n");
}

function contextOptionsHash(job: GenerationJob, tokenBudget: number): string {
  const input = (job.input ?? {}) as { contextOptions?: unknown };
  return stableHash({
    tokenBudget,
    contextOptions: input.contextOptions ?? null
  });
}

function latestTimestamp(values: Array<Date | string | null | undefined>): string {
  const latest = values.reduce<number>((max, value) => {
    if (!value) return max;
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(time) && time > max ? time : max;
  }, 0);
  return new Date(latest).toISOString();
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function readPerformanceConfig(job: GenerationJob) {
  const input = (job.input ?? {}) as {
    qualityMode?: unknown;
    performanceBudget?: PerformanceBudgetInput;
  };
  const qualityMode = normalizeQualityMode(input.qualityMode);
  return {
    qualityMode,
    budget: normalizePerformanceBudget(qualityMode, input.performanceBudget)
  };
}

interface CommitParams {
  prisma: PrismaClient;
  job: GenerationJob;
  chapter: ChapterRef;
  finalContent: string;
  wordCount: number;
  performanceSummary?: PerformanceSummary;
  diagnosticWarning?: string;
}

interface FinalOutput {
  chapterId: string;
  versionId: string;
  versionNo: number;
  wordCount: number;
  performanceSummary?: PerformanceSummary;
  diagnosticWarning?: string;
}

export async function commitFinalize(params: CommitParams): Promise<FinalOutput> {
  const { prisma, job, chapter, finalContent, wordCount, performanceSummary, diagnosticWarning } = params;

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
      ...(performanceSummary ? { performanceSummary } : {}),
      ...(diagnosticWarning ? { diagnosticWarning } : {})
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
      data: {
        status: "SUCCEEDED",
        progress: "100",
        finishedAt,
        output: output as unknown as Parameters<PrismaClient["generationJob"]["update"]>[0]["data"]["output"]
      }
    });

    return output;
  });
}

async function enqueueDeepDiagnostic(params: {
  prisma: PrismaClient;
  job: GenerationJob;
  chapter: ChapterRef;
  finalOutput: FinalOutput;
}): Promise<void> {
  const { prisma, job, chapter, finalOutput } = params;
  const diagnosticBudget = normalizePerformanceBudget("balanced", undefined);
  const diagnosticInput = {
    chapterId: chapter.id,
    parentJobId: job.id,
    qualityMode: "deep",
    performanceBudget: {
      maxModelCalls: diagnosticBudget.maxModelCalls,
      maxInputTokens: diagnosticBudget.maxInputTokens,
      maxOutputTokens: diagnosticBudget.maxOutputTokens,
      maxLatencyMs: diagnosticBudget.maxLatencyMs
    }
  };

  try {
    await prisma.generationJob.create({
      data: {
        organizationId: job.organizationId,
        projectId: job.projectId,
        userId: job.userId,
        jobType: "DIAGNOSE_CHAPTER",
        targetEntityType: "CHAPTER",
        targetEntityId: chapter.id,
        status: "QUEUED",
        progress: "0",
        input: diagnosticInput as unknown as Parameters<PrismaClient["generationJob"]["create"]>[0]["data"]["input"]
      }
    });
  } catch (error: unknown) {
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        output: {
          ...finalOutput,
          diagnosticWarning: errorMessage(error, "diagnostic enqueue failed")
        } as unknown as Parameters<PrismaClient["generationJob"]["update"]>[0]["data"]["output"]
      }
    });
  }
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
