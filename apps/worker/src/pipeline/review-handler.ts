import type { PrismaClient } from "@ai-novel/db";
import { normalizePerformanceBudget, normalizeQualityMode } from "@ai-novel/shared/generation/performance";
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

interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
}

interface ReviewInput {
  chapterId?: unknown;
  qualityMode?: unknown;
  performanceBudget?: unknown;
  instruction?: unknown;
}

export interface ReviewSuggestion {
  issueType: string;
  severity: "info" | "warning" | "error";
  quote: string;
  problem: string;
  suggestion: string;
  replacement?: string;
  verified: boolean;
}

export interface ReviewOutput {
  summary: string;
  passed: boolean;
  suggestions: ReviewSuggestion[];
  verifiedCount: number;
  unverifiedCount: number;
  degraded: boolean;
}

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const ISSUE_TYPES = [
  "consistency",
  "world_conflict",
  "foreshadowing",
  "timeline",
  "knowledge_boundary",
  "ai_slop",
  "pacing",
  "style_drift",
  "typo"
] as const;

const SEVERITIES = ["info", "warning", "error"] as const;

const MAX_CONTENT_CHARS = 12000;

function buildReviewPrompt(
  chapterTitle: string,
  content: string,
  instruction?: string
): string {
  return `你是严格的中文网文审校编辑。请审校下面的章节正文，找出真实存在的问题，并给出可直接替换的改法。

章节标题：${chapterTitle}

正文：
${content.slice(0, MAX_CONTENT_CHARS)}

要求：
- 每条问题必须附上「quote」字段，且 quote 必须是从正文中逐字复制的连续原文片段（10-80 字），不得改写、不得拼接
- 「replacement」给出可直接替换 quote 的改写文本；若该问题无法通过局部替换解决，replacement 留空字符串
- 只报告真实存在的问题，没有问题时 suggestions 返回空数组
- issueType 取值：${ISSUE_TYPES.join(" / ")}${instruction ? `\n- 额外关注：${instruction}` : ""}

只返回 JSON，不要任何解释：
{
  "summary": "一句话总体评价",
  "passed": true,
  "suggestions": [
    {
      "issueType": "ai_slop",
      "severity": "warning",
      "quote": "逐字复制的原文片段",
      "problem": "问题说明",
      "suggestion": "修改建议",
      "replacement": "替换后的文本（无法局部替换时为空字符串）"
    }
  ]
}`;
}

function safeJson<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/^\s*```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return fallback;
    }
  }
}

function normalizeSuggestion(raw: unknown): Omit<ReviewSuggestion, "verified"> | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const quote = typeof item.quote === "string" ? item.quote.trim() : "";
  const problem = typeof item.problem === "string" ? item.problem.trim() : "";
  const suggestion = typeof item.suggestion === "string" ? item.suggestion.trim() : "";
  if (!quote || !problem) return null;

  const issueType =
    typeof item.issueType === "string" && (ISSUE_TYPES as readonly string[]).includes(item.issueType)
      ? item.issueType
      : "consistency";
  const severity =
    typeof item.severity === "string" && (SEVERITIES as readonly string[]).includes(item.severity)
      ? (item.severity as ReviewSuggestion["severity"])
      : "warning";
  const replacement = typeof item.replacement === "string" ? item.replacement : "";

  return { issueType, severity, quote, problem, suggestion, replacement };
}

// 引证验真：模型给出的 quote 必须是章节正文里真实存在的一段。
// 审校模型编造引文是常见问题，未通过验真的条目仅作提示，不参与采纳。
export function verifySuggestions(content: string, suggestions: Array<Omit<ReviewSuggestion, "verified">>): ReviewSuggestion[] {
  return suggestions.map((item) => ({
    ...item,
    verified: item.quote.length > 0 && content.includes(item.quote)
  }));
}

export function createReviewHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const input = (job.input ?? {}) as ReviewInput;
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

    let model = builtinModel;
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
      } else if (!deps.model) {
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "无法解析 ModelProfile 且未配置兜底模型");
        return;
      }
    }

    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, title: true, content: true }
    });
    if (!chapter || !chapter.content) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, `章节 ${chapterId} 不存在或内容为空`);
      return;
    }

    const qualityMode = normalizeQualityMode(input.qualityMode);
    const budget = normalizePerformanceBudget(
      qualityMode,
      input.performanceBudget as Parameters<typeof normalizePerformanceBudget>[1]
    );
    const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";

    const step = await prisma.generationStep.create({
      data: {
        organizationId: job.organizationId,
        jobId: job.id,
        stepKey: "review",
        status: "RUNNING",
        startedAt: new Date()
      },
      select: { id: true }
    });

    const prompt = buildReviewPrompt(chapter.title, chapter.content, instruction || undefined);
    const started = Date.now();
    const result = await model.generate(prompt, { maxOutputTokens: budget.maxOutputTokens });
    const latencyMs = Date.now() - started;

    const parsed = safeJson<{ summary?: unknown; passed?: unknown; suggestions?: unknown }>(result.text, {});
    const parsedOk = parsed !== null && typeof parsed === "object" && "suggestions" in parsed;
    const rawSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const normalized = rawSuggestions
      .map((item) => normalizeSuggestion(item))
      .filter((item): item is Omit<ReviewSuggestion, "verified"> => item !== null);
    const suggestions = verifySuggestions(chapter.content, normalized);
    const verifiedCount = suggestions.filter((s) => s.verified).length;

    const output: ReviewOutput = {
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "审校完成",
      passed: parsed.passed === true || suggestions.length === 0,
      suggestions,
      verifiedCount,
      unverifiedCount: suggestions.length - verifiedCount,
      degraded: !parsedOk && result.text.trim().length > 0
    };

    await prisma.generationStep.update({
      where: { id: step.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        outputPreview: `suggestions=${suggestions.length} verified=${verifiedCount}`,
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
        review: output
      }
    });
  };
}
