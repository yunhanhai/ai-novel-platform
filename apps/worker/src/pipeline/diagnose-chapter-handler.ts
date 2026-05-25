import type { PrismaClient } from "@ai-novel/db";
import {
  createPerformanceTracker,
  normalizePerformanceBudget,
  normalizeQualityMode,
  type BudgetSkipReason,
  type PerformanceBudgetInput
} from "@ai-novel/shared/generation/performance";
import { createFakeModel } from "./fake-model";
import { readModelUsage, recordModelUsage } from "./usage-recorder";
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

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  HANDLER_ERROR: "HANDLER_ERROR",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

interface DiagnosticIssue {
  severity: "info" | "warning" | "error";
  detail: string;
  suggestion?: string;
}

interface ChapterDiagnosticSummary {
  summary?: string;
  readerScore: number;
  abandonRisk: "low" | "medium" | "high";
  hookStrength: number;
  pacingScore: number;
  styleDrift: number;
  continuityIssues: DiagnosticIssue[];
  suggestions: string[];
}

type DiagnosticJobType =
  | "DIAGNOSE_CHAPTER"
  | "READER_SIMULATION"
  | "STYLE_DRIFT_CHECK"
  | "CONTINUITY_CHECK";

interface DiagnosticProfile {
  jobType: DiagnosticJobType;
  stepKey: string;
  diagnosticType: string;
  label: string;
  focus: string;
  contentLimit: number;
}

const DIAGNOSTIC_PROFILES: Record<DiagnosticJobType, DiagnosticProfile> = {
  DIAGNOSE_CHAPTER: {
    jobType: "DIAGNOSE_CHAPTER",
    stepKey: "diagnose_chapter",
    diagnosticType: "diagnose_chapter",
    label: "Chapter diagnosis",
    focus: "provide a balanced overall quality check across reader appeal, pacing, style, and continuity",
    contentLimit: 10000
  },
  READER_SIMULATION: {
    jobType: "READER_SIMULATION",
    stepKey: "reader_simulation",
    diagnosticType: "reader_simulation",
    label: "Reader simulation",
    focus: "simulate a first-time reader and identify drop-off risk, confusing passages, weak hooks, and momentum loss",
    contentLimit: 8000
  },
  STYLE_DRIFT_CHECK: {
    jobType: "STYLE_DRIFT_CHECK",
    stepKey: "style_drift_check",
    diagnosticType: "style_drift_check",
    label: "Style drift check",
    focus: "detect style drift, voice inconsistency, sentence rhythm mismatch, and vocabulary drift from the brief",
    contentLimit: 7000
  },
  CONTINUITY_CHECK: {
    jobType: "CONTINUITY_CHECK",
    stepKey: "continuity_check",
    diagnosticType: "continuity_check",
    label: "Continuity check",
    focus: "spot continuity gaps, timeline conflicts, state drift, and contradictions with prior chapter facts",
    contentLimit: 8000
  }
};

export function createDiagnoseChapterHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const chapterId = resolveChapterId(job);
    if (!chapterId) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "Unable to resolve chapterId");
      return;
    }

    let model = builtinModel;
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
      } else if (!deps.model) {
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "Unable to resolve ModelProfile and no fallback model is configured");
        return;
      }
    }

    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: {
        id: true,
        title: true,
        outlineSummary: true,
        content: true,
        project: { select: { title: true, styleBrief: true } }
      }
    });

    if (!chapter || !chapter.content) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "Chapter does not exist or has no content");
      return;
    }

    const profile = getDiagnosticProfile(job.jobType);
    const performance = readPerformanceConfig(job);
    const tracker = createPerformanceTracker(performance);
    const prompt = buildDiagnosticPrompt(profile, {
      title: chapter.title,
      outlineSummary: chapter.outlineSummary ?? "",
      content: chapter.content,
      projectTitle: chapter.project?.title ?? job.projectId,
      styleBrief: chapter.project?.styleBrief ?? ""
    });
    const allowed = tracker.canRunModelStep(profile.stepKey, { estimatedInputTokens: estimatePromptTokens(prompt) });
    if (!allowed.ok) {
      await skipDiagnosticStep({
        prisma,
        updateJobStatus,
        job,
        chapterId: chapter.id,
        profile,
        tracker,
        reason: allowed.reason
      });
      return;
    }

    try {
      const step = await prisma.generationStep.create({
        data: {
          organizationId: job.organizationId,
          jobId: job.id,
          stepKey: profile.stepKey,
          status: "PENDING",
          startedAt: new Date()
        },
        select: { id: true }
      });

      const started = Date.now();
      const result = await model.generate(prompt);
      const elapsed = Date.now() - started;
      tracker.recordModelStep({
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: elapsed
      });
      await recordModelUsage({
        prisma,
        job,
        usage: readModelUsage(model),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: elapsed
      });

      const diagnosticSummary = parseDiagnosticSummary(result.text);
      await prisma.generationStep.update({
        where: { id: step.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          outputPreview:
            diagnosticSummary.summary ??
            diagnosticSummary.suggestions[0] ??
            `${profile.label} ${diagnosticSummary.readerScore}`,
          promptSnapshot: prompt.slice(0, 4000),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: elapsed
        }
      });

      await updateJobStatus({
        jobId: job.id,
        status: "SUCCEEDED",
        output: {
          chapterId: chapter.id,
          diagnosticType: profile.diagnosticType,
          diagnosticSummary: diagnosticSummary as unknown as Record<string, unknown>,
          performanceSummary: tracker.summary() as unknown as Record<string, unknown>
        }
      });
    } catch (error: unknown) {
      await fail(job.id, ERROR_CODES.HANDLER_ERROR, errorMessage(error, "diagnose chapter failed"));
    }
  };
}

function resolveChapterId(job: GenerationJob): string | null {
  if (job.targetEntityType === "CHAPTER" && job.targetEntityId) return job.targetEntityId;
  const input = (job.input ?? {}) as { chapterId?: unknown };
  return typeof input.chapterId === "string" && input.chapterId.length > 0 ? input.chapterId : null;
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

function getDiagnosticProfile(jobType: string): DiagnosticProfile {
  return isDiagnosticJobType(jobType) ? DIAGNOSTIC_PROFILES[jobType] : DIAGNOSTIC_PROFILES.DIAGNOSE_CHAPTER;
}

function isDiagnosticJobType(value: string): value is DiagnosticJobType {
  return value in DIAGNOSTIC_PROFILES;
}

async function skipDiagnosticStep(params: {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  job: GenerationJob;
  chapterId: string;
  profile: DiagnosticProfile;
  tracker: ReturnType<typeof createPerformanceTracker>;
  reason: BudgetSkipReason;
}): Promise<void> {
  const step = await params.prisma.generationStep.create({
    data: {
      organizationId: params.job.organizationId,
      jobId: params.job.id,
      stepKey: params.profile.stepKey,
      status: "PENDING",
      startedAt: new Date()
    },
    select: { id: true }
  });

  await params.prisma.generationStep.update({
    where: { id: step.id },
    data: {
      status: "SKIPPED",
      finishedAt: new Date(),
      outputPreview: params.reason,
      promptSnapshot: "",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0
    }
  });

  params.tracker.recordSkippedStep(params.profile.stepKey, params.reason);

  await params.updateJobStatus({
    jobId: params.job.id,
    status: "SUCCEEDED",
    output: {
      chapterId: params.chapterId,
      diagnosticType: params.profile.diagnosticType,
      performanceSummary: params.tracker.summary() as unknown as Record<string, unknown>
    }
  });
}

function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

function buildDiagnosticPrompt(profile: DiagnosticProfile, input: {
  title: string;
  outlineSummary: string;
  content: string;
  projectTitle: string;
  styleBrief: string;
}): string {
  const content = input.content.slice(0, profile.contentLimit);
  return `You are a fiction quality diagnostic system. Analyze the chapter and return strict JSON only.

Task: ${profile.label}
Focus: ${profile.focus}

Project: ${input.projectTitle}
Style: ${input.styleBrief}
Chapter: ${input.title}
Outline: ${input.outlineSummary}

Content:
${content}

Output schema:
{
  "summary": "One short sentence",
  "readerScore": 0,
  "abandonRisk": "low|medium|high",
  "hookStrength": 0,
  "pacingScore": 0,
  "styleDrift": 0,
  "continuityIssues": [{"severity": "info|warning|error", "detail": "", "suggestion": ""}],
  "suggestions": [""]
}`;
}

function parseDiagnosticSummary(text: string): ChapterDiagnosticSummary {
  const parsed = safeJson<Partial<ChapterDiagnosticSummary> | null>(text, null);
  if (!parsed) {
    return {
      summary: "Diagnostic output could not be parsed.",
      readerScore: 0,
      abandonRisk: "medium",
      hookStrength: 0,
      pacingScore: 0,
      styleDrift: 0,
      continuityIssues: [],
      suggestions: ["Diagnostic output could not be parsed."]
    };
  }

  return {
    summary: parseString(parsed.summary),
    readerScore: clampScore(parsed.readerScore),
    abandonRisk: parseRisk(parsed.abandonRisk),
    hookStrength: clampScore(parsed.hookStrength),
    pacingScore: clampScore(parsed.pacingScore),
    styleDrift: clampScore(parsed.styleDrift),
    continuityIssues: parseIssues(parsed.continuityIssues),
    suggestions: parseStringArray(parsed.suggestions)
  };
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

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseRisk(value: unknown): ChapterDiagnosticSummary["abandonRisk"] {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function parseIssues(value: unknown): DiagnosticIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const detail = typeof record.detail === "string" ? record.detail : "";
      if (!detail) return null;
      const severity = record.severity === "info" || record.severity === "warning" || record.severity === "error"
        ? record.severity
        : "warning";
      return {
        severity,
        detail,
        ...(typeof record.suggestion === "string" ? { suggestion: record.suggestion } : {})
      };
    })
    .filter((item): item is DiagnosticIssue => item !== null);
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
