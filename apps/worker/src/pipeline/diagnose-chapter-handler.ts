import type { PrismaClient } from "@ai-novel/db";
import {
  createPerformanceTracker,
  normalizePerformanceBudget,
  normalizeQualityMode,
  type PerformanceBudgetInput
} from "@ai-novel/shared/generation/performance";
import { createFakeModel } from "./fake-model";
import type { GenerationJob } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;

type UpdateStatusFn = (params: {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}) => Promise<unknown>;

export type DiagnosticType =
  | "DIAGNOSE_CHAPTER"
  | "READER_SIMULATION"
  | "STYLE_DRIFT_CHECK"
  | "CONTINUITY_CHECK";

interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
  diagnosticType?: DiagnosticType;
}

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  HANDLER_ERROR: "HANDLER_ERROR",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

type AbandonRisk = "low" | "medium" | "high";

interface ContinuityIssue {
  severity: "info" | "warning" | "error";
  detail: string;
  suggestion: string;
}

interface DiagnosticSummary {
  readerScore: number;
  abandonRisk: AbandonRisk;
  hookStrength: number;
  pacingScore: number;
  styleDrift: number;
  continuityIssues: ContinuityIssue[];
  suggestions: string[];
}

const DIAGNOSTIC_FOCUS: Record<DiagnosticType, string> = {
  DIAGNOSE_CHAPTER: "全面评估本章的读者体验、节奏、风格与连续性。",
  READER_SIMULATION: "重点模拟普通读者的真实阅读体验，评估弃书风险与开篇钩子强度。",
  STYLE_DRIFT_CHECK: "重点检查文风是否偏离既定风格定位，给出 styleDrift 评分与具体漂移点。",
  CONTINUITY_CHECK: "重点检查设定、时间线与人物知识边界的连续性问题，集中输出 continuityIssues。"
};

export function createDiagnoseChapterHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const diagnosticType = deps.diagnosticType ?? "DIAGNOSE_CHAPTER";
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const chapterId = resolveChapterId(job);
    if (!chapterId) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "无法解析 chapterId");
      return;
    }

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
      select: {
        id: true,
        title: true,
        outlineSummary: true,
        content: true,
        project: { select: { title: true, styleBrief: true } }
      }
    }) as DiagnoseChapter | null;
    if (!chapter || !chapter.content) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "章节不存在或正文为空");
      return;
    }

    const input = (job.input ?? {}) as { qualityMode?: unknown; performanceBudget?: PerformanceBudgetInput };
    const qualityMode = normalizeQualityMode(input.qualityMode);
    const budget = normalizePerformanceBudget(qualityMode, input.performanceBudget);
    const tracker = createPerformanceTracker({ qualityMode, budget });

    try {
      const prompt = buildDiagnosticPrompt({
        focus: DIAGNOSTIC_FOCUS[diagnosticType],
        chapterTitle: chapter.title,
        outlineSummary: chapter.outlineSummary,
        projectTitle: chapter.project?.title ?? job.projectId,
        styleBrief: chapter.project?.styleBrief ?? null,
        content: chapter.content
      });

      const step = await prisma.generationStep.create({
        data: {
          organizationId: job.organizationId,
          jobId: job.id,
          stepKey: "diagnose_chapter",
          status: "RUNNING",
          startedAt: new Date()
        },
        select: { id: true }
      });

      const started = Date.now();
      const result = await model.generate(prompt, { maxOutputTokens: budget.maxOutputTokens });
      const latencyMs = Date.now() - started;

      const { summary: diagnosticSummary, degraded } = diagnoseFromText(result.text);
      tracker.recordModelStep({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });

      await prisma.generationStep.update({
        where: { id: step.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          outputPreview: `readerScore=${diagnosticSummary.readerScore} abandonRisk=${diagnosticSummary.abandonRisk}`,
          promptSnapshot: prompt.slice(0, 4000),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs
        }
      });

      await updateJobStatus({
        jobId: job.id,
        status: "SUCCEEDED",
        output: {
          chapterId: chapter.id,
          diagnosticType,
          diagnosticSummary,
          performanceSummary: tracker.summary(),
          ...(degraded ? { diagnosticDegraded: true } : {})
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "diagnose failed";
      console.error(`[diagnose:${diagnosticType}] failed for job ${job.id}: ${message}`);
      throw error;
    }
  };
}

interface DiagnoseChapter {
  id: string;
  title: string;
  outlineSummary: string | null;
  content: string | null;
  project?: { title: string; styleBrief: string | null } | null;
}

function resolveChapterId(job: GenerationJob): string | null {
  if (job.targetEntityType === "CHAPTER" && job.targetEntityId) return job.targetEntityId;
  const input = (job.input ?? {}) as { chapterId?: unknown };
  return typeof input.chapterId === "string" && input.chapterId.length > 0 ? input.chapterId : null;
}

interface RawDiagnostic {
  readerScore?: unknown;
  abandonRisk?: unknown;
  hookStrength?: unknown;
  pacingScore?: unknown;
  styleDrift?: unknown;
  continuityIssues?: unknown;
  suggestions?: unknown;
}

function diagnoseFromText(text: string): { summary: DiagnosticSummary; degraded: boolean } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { summary: degradedSummary(), degraded: true };
  try {
    const raw = JSON.parse(match[0]) as RawDiagnostic;
    return { summary: normalizeDiagnostic(raw), degraded: false };
  } catch {
    return { summary: degradedSummary(), degraded: true };
  }
}

function normalizeDiagnostic(raw: RawDiagnostic): DiagnosticSummary {
  return {
    readerScore: clampScore(raw.readerScore),
    abandonRisk: normalizeAbandonRisk(raw.abandonRisk),
    hookStrength: clampScore(raw.hookStrength),
    pacingScore: clampScore(raw.pacingScore),
    styleDrift: clampScore(raw.styleDrift),
    continuityIssues: normalizeContinuityIssues(raw.continuityIssues),
    suggestions: normalizeStringArray(raw.suggestions)
  };
}

function degradedSummary(): DiagnosticSummary {
  return {
    readerScore: 0,
    abandonRisk: "medium",
    hookStrength: 0,
    pacingScore: 0,
    styleDrift: 0,
    continuityIssues: [],
    suggestions: ["模型未返回可解析的诊断 JSON，已降级。建议重试或检查模型配置。"]
  };
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeAbandonRisk(value: unknown): AbandonRisk {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function normalizeContinuityIssues(value: unknown): ContinuityIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      severity: normalizeSeverity(item.severity),
      detail: typeof item.detail === "string" ? item.detail : "",
      suggestion: typeof item.suggestion === "string" ? item.suggestion : ""
    }))
    .filter((issue) => issue.detail.length > 0);
}

function normalizeSeverity(value: unknown): ContinuityIssue["severity"] {
  return value === "warning" || value === "error" ? value : "info";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function buildDiagnosticPrompt(params: {
  focus: string;
  chapterTitle: string;
  outlineSummary: string | null;
  projectTitle: string;
  styleBrief: string | null;
  content: string;
}): string {
  return `你是资深小说编辑与读者体验分析师。${params.focus}

作品：${params.projectTitle}
章节：${params.chapterTitle}
章节大纲：${params.outlineSummary ?? "（无）"}
风格定位：${params.styleBrief ?? "（无）"}

章节正文：
${params.content.slice(0, 8000)}

仅以如下 JSON 输出分析结论：
{
  "readerScore": 0,
  "abandonRisk": "low|medium|high",
  "hookStrength": 0,
  "pacingScore": 0,
  "styleDrift": 0,
  "continuityIssues": [{"severity": "info|warning|error", "detail": "", "suggestion": ""}],
  "suggestions": [""]
}

所有评分均为 0-100 的整数。`;
}
