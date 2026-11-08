import type { PrismaClient, Prisma } from "@ai-novel/db";
import { lockMemorySourceChapter } from "@ai-novel/db/chapter-memory";
import { createHash } from "node:crypto";
import { createPerformanceTracker, normalizePerformanceBudget, normalizeQualityMode, type PerformanceBudgetInput } from "@ai-novel/shared/generation/performance";
import { createFakeModel } from "./fake-model";
import { recordModelUsage } from "./usage-recorder";
import { ChapterSourceChanged } from "./chapter-save";
import type { GenerationJob, UpdateStatusFn } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;
export type DiagnosticType = "DIAGNOSE_CHAPTER" | "READER_SIMULATION" | "STYLE_DRIFT_CHECK" | "CONTINUITY_CHECK";
interface HandlerDeps { prisma: PrismaClient; updateJobStatus: UpdateStatusFn; model?: FakeModel; resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>; diagnosticType?: DiagnosticType }
interface ContinuityIssue { severity: "info" | "warning" | "error"; detail: string; suggestion: string }
export interface DiagnosticSummary { readerScore: number; abandonRisk: "low" | "medium" | "high"; hookStrength: number; pacingScore: number; styleDrift: number; continuityIssues: ContinuityIssue[]; suggestions: string[] }
interface DiagnoseChapter { id: string; title: string; outlineSummary: string | null; content: string | null; project?: { title: string; styleBrief: string | null; premise?: string | null } | null }
interface DiagnosticInput { chapterId?: unknown; qualityMode?: unknown; performanceBudget?: PerformanceBudgetInput }
export const MAX_DIAGNOSTIC_SOURCE_CHARS = 20000;
const INVALID_REPORT = "模型未返回完整有效的诊断 JSON，请重新诊断；本次未生成有效评分，正文未修改";
const DIAGNOSTIC_FOCUS: Record<DiagnosticType, string> = {
  DIAGNOSE_CHAPTER: "全面评估本章的读者体验、节奏、风格与连续性。",
  READER_SIMULATION: "重点模拟普通读者的阅读体验，给出弃书风险与开篇钩子的参考判断。",
  STYLE_DRIFT_CHECK: "重点检查文风是否偏离既定风格定位，给出 styleDrift 评分与具体漂移点。",
  CONTINUITY_CHECK: "重点检查设定、时间线与人物知识边界的连续性问题，集中输出 continuityIssues。"
};

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function parseDiagnostic(text: string): DiagnosticSummary | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/i, "$1");
  let raw: unknown;
  try { raw = JSON.parse(cleaned); } catch { return null; }
  if (!isRecord(raw)) return null;
  const scores = [raw.readerScore, raw.hookStrength, raw.pacingScore, raw.styleDrift];
  if (!scores.every(score => typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 100) ||
    typeof raw.abandonRisk !== "string" || !["low", "medium", "high"].includes(raw.abandonRisk) ||
    !Array.isArray(raw.suggestions) || !raw.suggestions.every(item => typeof item === "string" && item.trim().length > 0) ||
    !Array.isArray(raw.continuityIssues)) return null;
  const continuityIssues: ContinuityIssue[] = [];
  for (const value of raw.continuityIssues) {
    if (!isRecord(value) || typeof value.severity !== "string" || !["info", "warning", "error"].includes(value.severity) ||
      typeof value.detail !== "string" || !value.detail.trim() || typeof value.suggestion !== "string" || !value.suggestion.trim()) return null;
    continuityIssues.push({ severity: value.severity as ContinuityIssue["severity"], detail: value.detail.trim(), suggestion: value.suggestion.trim() });
  }
  return { readerScore: raw.readerScore as number, abandonRisk: raw.abandonRisk as DiagnosticSummary["abandonRisk"], hookStrength: raw.hookStrength as number, pacingScore: raw.pacingScore as number, styleDrift: raw.styleDrift as number, continuityIssues, suggestions: (raw.suggestions as string[]).map(item => item.trim()) };
}

export function createDiagnoseChapterHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const diagnosticType = deps.diagnosticType ?? "DIAGNOSE_CHAPTER";
  return async function handle(job: GenerationJob): Promise<void> {
    if (job.jobType !== diagnosticType) return;
    const current = await prisma.generationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, projectId: job.projectId, jobType: diagnosticType }, select: { status: true, attemptCount: true } });
    if (!current || current.status !== "RUNNING" || current.attemptCount !== (job.attemptCount ?? 1)) return;
    const fail = (errorCode: string, errorMessage: string) => updateJobStatus({ jobId: job.id, status: "FAILED", errorCode, errorMessage, expectedStatus: "RUNNING", expectedAttemptCount: job.attemptCount ?? 1 });
    const input = (job.input ?? {}) as DiagnosticInput;
    const boundChapterId = job.targetEntityType === "CHAPTER" && job.targetEntityId ? job.targetEntityId : null;
    const inputChapterId = typeof input.chapterId === "string" && input.chapterId ? input.chapterId : null;
    if (boundChapterId && inputChapterId && boundChapterId !== inputChapterId) { await fail("CHAPTER_TARGET_MISMATCH", "诊断任务目标与输入章节不一致，请重新发起"); return; }
    const chapterId = boundChapterId ?? inputChapterId;
    if (!chapterId) { await fail("CHAPTER_NOT_FOUND", "无法解析 chapterId"); return; }
    const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null }, select: { id: true, title: true, outlineSummary: true, content: true, project: { select: { title: true, styleBrief: true, premise: true } } } }) as DiagnoseChapter | null;
    if (!chapter?.content?.trim()) { await fail("CHAPTER_NOT_FOUND", "章节不存在或正文为空"); return; }
    const sourceContent = chapter.content;
    let sourceChars = 0;
    for (const _ of sourceContent) {
      if (++sourceChars > MAX_DIAGNOSTIC_SOURCE_CHARS) { await fail("DIAGNOSTIC_SOURCE_TOO_LONG", `本章超过单次诊断上限${MAX_DIAGNOSTIC_SOURCE_CHARS}字，请拆章后重新诊断；正文未修改`); return; }
    }
    let model = deps.model ?? createFakeModel();
    if (deps.resolveModel) {
      const resolved = await deps.resolveModel(job);
      if (resolved) model = resolved;
      else if (!deps.model) { await fail("NO_MODEL_PROFILE", "无法解析 ModelProfile 且未启用兜底模型"); return; }
    }
    const qualityMode = normalizeQualityMode(input.qualityMode);
    const budget = normalizePerformanceBudget(qualityMode, input.performanceBudget);
    const tracker = createPerformanceTracker({ qualityMode, budget });
    const prompt = buildDiagnosticPrompt({ focus: DIAGNOSTIC_FOCUS[diagnosticType], chapterTitle: chapter.title, outlineSummary: chapter.outlineSummary, projectTitle: chapter.project?.title ?? job.projectId, styleBrief: chapter.project?.styleBrief ?? null, premise: chapter.project?.premise ?? null, content: sourceContent });
    const step = await prisma.generationStep.create({ data: { organizationId: job.organizationId, jobId: job.id, stepKey: "diagnose_chapter", promptSnapshot: prompt.slice(0, 4000), status: "RUNNING", startedAt: new Date() }, select: { id: true } });
    const started = Date.now();
    try {
      const result = await model.generate(prompt, { maxOutputTokens: budget.maxOutputTokens, responseFormat: "json_object" });
      const latencyMs = Date.now() - started;
      await recordModelUsage({ prisma, job, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });
      tracker.recordModelStep({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });
      const diagnosticSummary = parseDiagnostic(result.text);
      await prisma.$transaction(async tx => {
        let source: { content: string | null };
        try { source = await lockMemorySourceChapter({ tx, organizationId: job.organizationId, projectId: job.projectId, chapterId }); }
        catch (error) { if (error instanceof Error && error.message === "章节不存在或不属于当前项目") throw new ChapterSourceChanged(); throw error; }
        const rows = await tx.$queryRaw<Array<{ status: string; attemptCount: number }>>`
          SELECT upper(status::text) AS status, attempt_count AS "attemptCount" FROM generation_jobs
          WHERE id = ${job.id}::uuid AND organization_id = ${job.organizationId}::uuid
            AND project_id = ${job.projectId}::uuid AND job_type::text = ${diagnosticType.toLowerCase()} FOR UPDATE
        `;
        if (!rows[0] || rows[0].status !== "RUNNING" || rows[0].attemptCount !== (job.attemptCount ?? 1)) {
          await tx.generationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", finishedAt: new Date(), latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, outputPreview: "任务已取消、结束或执行已更新，未采用本次诊断报告" } });
          return;
        }
        if (source.content !== sourceContent) throw new ChapterSourceChanged();
        const finishedAt = new Date();
        await tx.generationStep.update({ where: { id: step.id }, data: { status: diagnosticSummary ? "SUCCEEDED" : "FAILED", finishedAt, latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, ...(diagnosticSummary ? { outputPreview: `readerScore=${diagnosticSummary.readerScore} abandonRisk=${diagnosticSummary.abandonRisk}` } : { errorMessage: INVALID_REPORT }) } });
        await tx.generationJob.update({ where: { id: job.id }, data: diagnosticSummary ? {
          status: "SUCCEEDED", progress: "100", finishedAt, errorCode: null, errorMessage: null,
          output: { chapterId, sourceSha256: createHash("sha256").update(sourceContent).digest("hex"), sourceChars, diagnosticType, diagnosticSummary, performanceSummary: tracker.summary() } as unknown as Prisma.InputJsonValue
        } : { status: "FAILED", finishedAt, errorCode: "INVALID_MODEL_OUTPUT", errorMessage: INVALID_REPORT } });
      });
    } catch (error) {
      try {
        const receipt = await prisma.generationStep.findFirst({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: { in: ["SUCCEEDED", "FAILED", "SKIPPED"] } }, select: { status: true } });
        if (receipt) return;
      } catch { /* Receipt failures cannot replace the original error. */ }
      try { await prisma.generationStep.updateMany({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), latencyMs: Date.now() - started, errorMessage: error instanceof ChapterSourceChanged ? "来源正文已变化，本次诊断报告未采用" : "诊断未完成，未取得有效报告" } }); }
      catch { /* Preserve model/storage classification for the poller. */ }
      throw error;
    }
  };
}

function buildDiagnosticPrompt(params: { focus: string; chapterTitle: string; outlineSummary: string | null; projectTitle: string; premise: string | null; styleBrief: string | null; content: string }): string {
  return `你是资深小说编辑与读者体验分析师。${params.focus}

作品：${params.projectTitle}
作品梗概：${params.premise ?? "（无）"}
章节：${params.chapterTitle}
章节大纲：${params.outlineSummary ?? "（无）"}
风格定位：${params.styleBrief ?? "（无）"}

完整章节正文：
${params.content}

仅以如下 JSON 输出分析结论：
{"readerScore":82,"abandonRisk":"low","hookStrength":70,"pacingScore":75,"styleDrift":10,"continuityIssues":[{"severity":"warning","detail":"具体连续性问题","suggestion":"具体修改建议"}],"suggestions":["具体阅读建议"]}

readerScore、hookStrength、pacingScore越高越好；styleDrift表示风格漂移，0=无漂移、100=完全偏离，越低越好。所有评分均为0-100整数。评分与弃书风险仅是模型参考意见，不代表真实读者行为或实测结果。
只输出最终JSON，最多3条连续性问题、3条建议，每条不超过60字。未发现问题时数组可为空。不得把梗概中未写出的事件当作正文已发生的事实。`;
}
