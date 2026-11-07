import type { PrismaClient, Prisma } from "@ai-novel/db";
import { lockMemorySourceChapter } from "@ai-novel/db/chapter-memory";
import { createHash } from "node:crypto";
import { normalizePerformanceBudget, normalizeQualityMode } from "@ai-novel/shared/generation/performance";
import { createFakeModel } from "./fake-model";
import { ChapterSourceChanged } from "./chapter-save";
import { recordModelUsage } from "./usage-recorder";
import type { GenerationJob, UpdateStatusFn } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;
interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
}
interface ReviewInput { chapterId?: unknown; qualityMode?: unknown; performanceBudget?: unknown; instruction?: unknown }
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
const ISSUE_TYPES = ["consistency", "world_conflict", "foreshadowing", "timeline", "knowledge_boundary", "ai_slop", "pacing", "style_drift", "typo"] as const;
const SEVERITIES = ["info", "warning", "error"] as const;
export const MAX_REVIEW_SOURCE_CHARS = 20000;
const INVALID_REPORT = "模型未返回完整的审校 JSON，请重新审校；本次未判断通过，正文未修改";

function buildReviewPrompt(chapterTitle: string, content: string, instruction?: string): string {
  return `你是严格的中文网文审校编辑。请审校下面的完整章节正文，找出真实存在的问题，并给出可直接替换的改法。

章节标题：${chapterTitle}

正文：
${content}

要求：
- 每条问题必须附上「quote」字段，且 quote 必须是从正文中逐字复制的连续原文片段（10-80 字），不得改写、不得拼接；引用应足够完整，能在正文唯一定位
- 「replacement」给出可直接替换 quote 的改写文本；若该问题无法通过局部替换解决，replacement 留空字符串
- 只报告真实存在的问题，没有问题时 suggestions 返回空数组；passed 必须是布尔值，summary 必须非空
- severity 取值：${SEVERITIES.join(" / ")}
- issueType 取值：${ISSUE_TYPES.join(" / ")}${instruction ? `\n- 额外关注：${instruction}` : ""}

只返回 JSON，不要任何解释：
{"summary":"一句话总体评价","passed":false,"suggestions":[{"issueType":"ai_slop","severity":"warning","quote":"逐字复制的原文片段","problem":"问题说明","suggestion":"具体修改建议","replacement":"替换后的文本（无法局部替换时为空字符串）"}]}`;
}

// Presence alone cannot locate repeated quotes, including overlapping occurrences.
export function verifySuggestions(content: string, suggestions: Array<Omit<ReviewSuggestion, "verified">>): ReviewSuggestion[] {
  return suggestions.map(item => {
    const start = item.quote ? content.indexOf(item.quote) : -1;
    return { ...item, verified: start >= 0 && content.indexOf(item.quote, start + 1) < 0 };
  });
}

function parseReviewReport(text: string, source: string): ReviewOutput | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/i, "$1");
  let value: unknown;
  try { value = JSON.parse(cleaned); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.summary !== "string" || !raw.summary.trim() || typeof raw.passed !== "boolean" || !Array.isArray(raw.suggestions)) return null;
  const normalized: Array<Omit<ReviewSuggestion, "verified">> = [];
  for (const value of raw.suggestions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.issueType !== "string" || !(ISSUE_TYPES as readonly string[]).includes(row.issueType) ||
      typeof row.severity !== "string" || !(SEVERITIES as readonly string[]).includes(row.severity) ||
      typeof row.quote !== "string" || !row.quote.trim() || typeof row.problem !== "string" || !row.problem.trim() ||
      typeof row.suggestion !== "string" || !row.suggestion.trim() || (row.replacement !== undefined && typeof row.replacement !== "string")) return null;
    normalized.push({ issueType: row.issueType, severity: row.severity as ReviewSuggestion["severity"], quote: row.quote, problem: row.problem.trim(), suggestion: row.suggestion.trim(), replacement: row.replacement as string | undefined ?? "" });
  }
  const suggestions = verifySuggestions(source, normalized);
  const verifiedCount = suggestions.filter(row => row.verified).length;
  return { summary: raw.summary.trim(), passed: raw.passed, suggestions, verifiedCount, unverifiedCount: suggestions.length - verifiedCount, degraded: false };
}

export function createReviewHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  return async function handle(job: GenerationJob): Promise<void> {
    if (job.jobType !== "REVIEW") return;
    const current = await prisma.generationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, projectId: job.projectId, jobType: "REVIEW" }, select: { status: true, attemptCount: true } });
    if (!current || current.status !== "RUNNING" || current.attemptCount !== (job.attemptCount ?? 1)) return;
    const fail = (code: string, message: string) => updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: code, errorMessage: message, expectedStatus: "RUNNING", expectedAttemptCount: job.attemptCount ?? 1 });
    const input = (job.input ?? {}) as ReviewInput;
    const boundChapterId = job.targetEntityType === "CHAPTER" && job.targetEntityId ? job.targetEntityId : null;
    const inputChapterId = typeof input.chapterId === "string" && input.chapterId ? input.chapterId : null;
    if (boundChapterId && inputChapterId && boundChapterId !== inputChapterId) { await fail("CHAPTER_TARGET_MISMATCH", "审校任务目标与输入章节不一致，请重新发起"); return; }
    const chapterId = boundChapterId ?? inputChapterId;
    if (!chapterId) { await fail("CHAPTER_NOT_FOUND", "无法从任务目标解析 chapterId"); return; }
    const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null }, select: { id: true, title: true, content: true } });
    if (!chapter?.content?.trim()) { await fail("CHAPTER_NOT_FOUND", "章节不存在或正文为空"); return; }
    const sourceContent = chapter.content;
    let sourceChars = 0;
    for (const _ of sourceContent) {
      if (++sourceChars > MAX_REVIEW_SOURCE_CHARS) { await fail("REVIEW_SOURCE_TOO_LONG", `本章超过单次审校上限${MAX_REVIEW_SOURCE_CHARS}字，请拆章后重新审校；正文未修改`); return; }
    }
    let model = deps.model ?? createFakeModel();
    if (deps.resolveModel) {
      const resolved = await deps.resolveModel(job);
      if (resolved) model = resolved;
      else if (!deps.model) { await fail("NO_MODEL_PROFILE", "无法解析 ModelProfile 且未配置兜底模型"); return; }
    }
    const qualityMode = normalizeQualityMode(input.qualityMode);
    const budget = normalizePerformanceBudget(qualityMode, input.performanceBudget as Parameters<typeof normalizePerformanceBudget>[1]);
    const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
    const prompt = buildReviewPrompt(chapter.title, sourceContent, instruction || undefined);
    const step = await prisma.generationStep.create({ data: { organizationId: job.organizationId, jobId: job.id, stepKey: "review", status: "RUNNING", startedAt: new Date() }, select: { id: true } });
    const started = Date.now();
    try {
      const result = await model.generate(prompt, { responseFormat: "json_object", maxOutputTokens: budget.maxOutputTokens });
      const latencyMs = Date.now() - started;
      await recordModelUsage({ prisma, job, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });
      const review = parseReviewReport(result.text, sourceContent);
      await prisma.$transaction(async tx => {
        let source: { content: string | null };
        try { source = await lockMemorySourceChapter({ tx, organizationId: job.organizationId, projectId: job.projectId, chapterId }); }
        catch (error) {
          if (error instanceof Error && error.message === "章节不存在或不属于当前项目") throw new ChapterSourceChanged();
          throw error;
        }
        const rows = await tx.$queryRaw<Array<{ status: string; attemptCount: number }>>`
          SELECT upper(status::text) AS status, attempt_count AS "attemptCount" FROM generation_jobs
          WHERE id = ${job.id}::uuid AND organization_id = ${job.organizationId}::uuid
            AND project_id = ${job.projectId}::uuid AND job_type = 'review' FOR UPDATE
        `;
        if (!rows[0] || rows[0].status !== "RUNNING" || rows[0].attemptCount !== (job.attemptCount ?? 1)) {
          await tx.generationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", finishedAt: new Date(), latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, outputPreview: "任务已取消、结束或执行已更新，未采用本次审校报告" } });
          return;
        }
        if (source.content !== sourceContent) throw new ChapterSourceChanged();
        const finishedAt = new Date();
        await tx.generationStep.update({ where: { id: step.id }, data: { status: review ? "SUCCEEDED" : "FAILED", finishedAt, latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, ...(review ? { outputPreview: `suggestions=${review.suggestions.length} verified=${review.verifiedCount}`, promptSnapshot: prompt.slice(0, 4000) } : { errorMessage: INVALID_REPORT }) } });
        await tx.generationJob.update({ where: { id: job.id }, data: review ? {
          status: "SUCCEEDED", progress: "100", finishedAt, errorCode: null, errorMessage: null,
          output: { chapterId, sourceSha256: createHash("sha256").update(sourceContent).digest("hex"), sourceChars, review } as unknown as Prisma.InputJsonValue
        } : { status: "FAILED", finishedAt, errorCode: "INVALID_MODEL_OUTPUT", errorMessage: INVALID_REPORT } });
      });
    } catch (error) {
      // Every final step is committed atomically with its report or rejection.
      // Recover a lost commit acknowledgment without another model request.
      try {
        const receipt = await prisma.generationStep.findFirst({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: { in: ["SUCCEEDED", "FAILED", "SKIPPED"] } }, select: { status: true } });
        if (receipt) return;
      } catch { /* Receipt failures cannot replace the original error. */ }
      try { await prisma.generationStep.updateMany({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), latencyMs: Date.now() - started, errorMessage: error instanceof ChapterSourceChanged ? "来源正文已变化，本次审校报告未采用" : "审校未完成，未取得有效报告" } }); }
      catch { /* Keep provider/storage classification for the poller. */ }
      throw error;
    }
  };
}
