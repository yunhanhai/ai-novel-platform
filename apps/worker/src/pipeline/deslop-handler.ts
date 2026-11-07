import type { PrismaClient, Prisma } from "@ai-novel/db";
import { lockMemorySourceChapter } from "@ai-novel/db/chapter-memory";
import { createHash } from "node:crypto";
import { createFakeModel } from "./fake-model";
import { recordModelUsage } from "./usage-recorder";
import { parseDeslopReport } from "./deslop-report";
import { ChapterSourceChanged } from "./chapter-save";
import type { GenerationJob, UpdateStatusFn } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;
interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
}
export const MAX_DESLOP_SOURCE_CHARS = 20000;
const INVALID_REPORT = "模型未返回可核对的去 AI 味报告，请重试分析；正文未修改";

export function createDeslopHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  return async function handle(job: GenerationJob): Promise<void> {
    const fail = (code: string, message: string) => updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: code, errorMessage: message, expectedAttemptCount: job.attemptCount ?? 1, expectedStatus: "RUNNING" });
    const chapterId = resolveChapterId(job);
    if (!chapterId) { await fail("CHAPTER_NOT_FOUND", "无法解析 chapterId"); return; }
    const current = await prisma.generationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, projectId: job.projectId }, select: { status: true, attemptCount: true } });
    if (!current || current.status !== "RUNNING" || current.attemptCount !== (job.attemptCount ?? 1)) return;
    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, content: true, title: true }
    });
    if (!chapter?.content?.trim()) { await fail("CHAPTER_NOT_FOUND", "章节不存在或正文为空"); return; }
    let sourceChars = 0;
    for (const _ of chapter.content) {
      if (++sourceChars > MAX_DESLOP_SOURCE_CHARS) { await fail("DESLOP_SOURCE_TOO_LONG", `本章超过单次去 AI 味分析上限${MAX_DESLOP_SOURCE_CHARS}字，请拆章后重试；正文未修改`); return; }
    }
    let model = deps.model ?? createFakeModel();
    if (deps.resolveModel) {
      const resolved = await deps.resolveModel(job);
      if (resolved) model = resolved;
      else if (!deps.model) { await fail("NO_MODEL_PROFILE", "无法解析 ModelProfile 且未启用兜底模型"); return; }
    }
    const prompt = `你是中文小说语言审阅员。阅读完整正文，指出可核对的套话与表达问题。只返回合法 JSON。自然度参考分0至100，越高越自然；分数是语言建议，不能判断作者身份。每条matched必须逐字引用正文，禁止编造证据。

正文：
${chapter.content}

输出格式：
{"issues":[{"category":"stock_phrase|weak_adverb|summary_sentence|abstract_noun_triple|repetition|passive_voice|telling_not_showing","severity":"info|warning|error","matched":"正文片段","suggestion":"具体修改建议","position":{"start":0,"end":0}}],"overallScore":85,"summary":"整体评估"}
position为原始JavaScript字符串的UTF16索引；无法准确定位时填0，但引用必须唯一可定位。没有问题时issues可以为空，摘要和分数仍必须给出。`;
    const step = await prisma.generationStep.create({ data: { organizationId: job.organizationId, jobId: job.id, stepKey: "deslop_analyze", status: "RUNNING", startedAt: new Date() }, select: { id: true } });
    const started = Date.now();
    try {
      const result = await model.generate(prompt, { responseFormat: "json_object" });
      const latencyMs = Date.now() - started;
      await recordModelUsage({ prisma, job, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });
      const report = parseDeslopReport(result.text, chapter.content);
      if (!report) {
        const latest = await prisma.generationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, projectId: job.projectId }, select: { status: true, attemptCount: true } });
        if (!latest || latest.status !== "RUNNING" || latest.attemptCount !== (job.attemptCount ?? 1)) {
          await prisma.generationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", finishedAt: new Date(), latencyMs, outputPreview: "任务已取消、结束或执行已更新，未采用本次响应" } });
          return;
        }
        await prisma.generationStep.update({ where: { id: step.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: INVALID_REPORT, latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens } });
        await fail("INVALID_MODEL_OUTPUT", INVALID_REPORT);
        return;
      }
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
            AND project_id = ${job.projectId}::uuid AND job_type = 'deslop' FOR UPDATE
        `;
        if (!rows[0] || rows[0].status !== "RUNNING" || rows[0].attemptCount !== (job.attemptCount ?? 1)) {
          await tx.generationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", finishedAt: new Date(), latencyMs, outputPreview: "任务已取消、结束或执行已更新，未采用本次报告" } });
          return;
        }
        if (source.content !== chapter.content) throw new ChapterSourceChanged();
        await tx.generationStep.update({ where: { id: step.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), outputPreview: report.summary, latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens } });
        await tx.generationJob.update({ where: { id: job.id }, data: {
          status: "SUCCEEDED", progress: "100", finishedAt: new Date(), errorCode: null, errorMessage: null,
          output: { chapterId, issueCount: report.issues.length, overallScore: report.overallScore, summary: report.summary,
            deslopReport: { ...report, sourceChars, sourceSha256: createHash("sha256").update(chapter.content!).digest("hex") }
          } as unknown as Prisma.InputJsonValue
        } });
      });
    } catch (error) {
      // The report and this step commit together. A lost transaction acknowledgment
      // must not turn their durable success into a failure or another model call.
      try {
        const committed = await prisma.generationStep.findFirst({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: "SUCCEEDED" }, select: { status: true } });
        if (committed) return;
      } catch { /* A receipt read failure must preserve the original error. */ }
      try { await prisma.generationStep.updateMany({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), latencyMs: Date.now() - started, errorMessage: error instanceof ChapterSourceChanged ? "来源正文已变化，本次报告未采用" : "去 AI 味分析未完成，未取得有效报告" } }); }
      catch { /* Keep the original error for poll classification. */ }
      throw error;
    }
  };
}
function resolveChapterId(job: GenerationJob): string | null {
  if (job.targetEntityType === "CHAPTER" && job.targetEntityId) return job.targetEntityId;
  const input = (job.input ?? {}) as { chapterId?: unknown };
  return typeof input.chapterId === "string" && input.chapterId.length > 0 ? input.chapterId : null;
}
