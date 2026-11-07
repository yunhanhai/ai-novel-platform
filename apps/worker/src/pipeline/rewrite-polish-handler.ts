import type { PrismaClient, Prisma } from "@ai-novel/db";
import { lockMemorySourceChapter } from "@ai-novel/db/chapter-memory";
import { createHash } from "node:crypto";
import { createFakeModel } from "./fake-model";
import { ChapterSourceChanged } from "./chapter-save";
import { recordModelUsage } from "./usage-recorder";
import type { GenerationJob, UpdateStatusFn } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;
interface RewritePolishInput { chapterId?: unknown; selectedText?: unknown; instruction?: unknown }
interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
}
function buildPrompt(jobType: string, selectedText: string, instruction?: string): string {
  const task =
    jobType === "POLISH"
      ? `你是资深中文网文编辑。请润色以下选中文本，要求：
- 修正错别字、标点和语病
- 优化句式节奏，让文字更流畅自然
- 不改变情节、人物与信息量，不增删内容
- 与所在章节的叙述人称、时态、语气保持一致`
      : `你是资深中文网文作者。请重写以下选中文本，要求：
- 保持原有情节、人物、信息量完全一致
- 换一种更好的写法：更强的画面感、更自然的对话、去掉陈词滥调
- 与所在章节的叙述人称、时态、语气保持一致`;

  return [
    `${task}${instruction ? `\n- 优先满足用户的额外要求：${instruction}` : ""}`,
    "",
    "选中文本如下：",
    selectedText,
    "",
    "直接输出处理后的正文，不要任何解释、标题、前后缀或 markdown 代码块。"
  ].join("\n");
}

export function createRewritePolishHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  return async function handle(job: GenerationJob): Promise<void> {
    if (job.jobType !== "REWRITE" && job.jobType !== "POLISH") return;
    const current = await prisma.generationJob.findFirst({
      where: { id: job.id, organizationId: job.organizationId, projectId: job.projectId, jobType: job.jobType },
      select: { status: true, attemptCount: true }
    });
    if (!current || current.status !== "RUNNING" || current.attemptCount !== (job.attemptCount ?? 1)) return;
    const fail = (code: string, message: string) => updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: code, errorMessage: message, expectedStatus: "RUNNING", expectedAttemptCount: job.attemptCount ?? 1 });
    const input = (job.input ?? {}) as RewritePolishInput;
    const selectedText = typeof input.selectedText === "string" && input.selectedText.trim() ? input.selectedText : null;
    if (!selectedText) { await fail("SELECTION_MISSING", "缺少待处理的选中文本 selectedText"); return; }
    const chapterId = job.targetEntityType === "CHAPTER" && job.targetEntityId
      ? job.targetEntityId : typeof input.chapterId === "string" && input.chapterId ? input.chapterId : null;
    if (!chapterId) { await fail("CHAPTER_NOT_FOUND", "无法从任务目标解析 chapterId"); return; }
    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null }, select: { content: true }
    });
    if (!chapter?.content) { await fail("CHAPTER_NOT_FOUND", "章节不存在或内容为空"); return; }
    const sourceContent = chapter.content;
    if (!sourceContent.includes(selectedText)) { await fail("SELECTION_STALE", "选中文本已不在当前章节内容中，请刷新后重新选择"); return; }
    let model = deps.model ?? createFakeModel();
    if (deps.resolveModel) {
      const resolved = await deps.resolveModel(job);
      if (resolved) model = resolved;
      else if (!deps.model) { await fail("NO_MODEL_PROFILE", "无法解析 ModelProfile 且未配置兜底模型"); return; }
    }
    const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
    const stepKey = job.jobType === "POLISH" ? "polish_selection" : "rewrite_selection";
    const step = await prisma.generationStep.create({ data: { organizationId: job.organizationId, jobId: job.id, stepKey, status: "RUNNING", startedAt: new Date() }, select: { id: true } });
    const started = Date.now();
    try {
      const result = await model.generate(buildPrompt(job.jobType, selectedText, instruction || undefined));
      const latencyMs = Date.now() - started;
      await recordModelUsage({ prisma, job, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });
      const newText = result.text.trim();
      await prisma.$transaction(async tx => {
        let source: { content: string | null };
        try { source = await lockMemorySourceChapter({ tx, organizationId: job.organizationId, projectId: job.projectId, chapterId }); }
        catch (error) {
          if (error instanceof Error && error.message === "章节不存在或不属于当前项目") throw new ChapterSourceChanged();
          throw error;
        }
        const databaseType = job.jobType === "POLISH" ? "polish" : "rewrite";
        const rows = await tx.$queryRaw<Array<{ status: string; attemptCount: number }>>`
          SELECT upper(status::text) AS status, attempt_count AS "attemptCount" FROM generation_jobs
          WHERE id = ${job.id}::uuid AND organization_id = ${job.organizationId}::uuid
            AND project_id = ${job.projectId}::uuid AND job_type = ${databaseType}::generation_job_type FOR UPDATE
        `;
        if (!rows[0] || rows[0].status !== "RUNNING" || rows[0].attemptCount !== (job.attemptCount ?? 1)) {
          await tx.generationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", finishedAt: new Date(), latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, outputPreview: "任务已取消、结束或执行已更新，未采用本次候选" } });
          return;
        }
        if (source.content !== sourceContent) throw new ChapterSourceChanged();
        const finishedAt = new Date();
        await tx.generationStep.update({ where: { id: step.id }, data: { status: newText ? "SUCCEEDED" : "FAILED", finishedAt, latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, ...(newText ? {} : { errorMessage: "模型未返回任何文本" }) } });
        await tx.generationJob.update({ where: { id: job.id }, data: newText ? {
          status: "SUCCEEDED", progress: "100", finishedAt, errorCode: null, errorMessage: null,
          output: { mode: job.jobType, selectedText, newText, chapterId, sourceSha256: createHash("sha256").update(sourceContent).digest("hex") } as Prisma.InputJsonValue
        } : { status: "FAILED", finishedAt, errorCode: "EMPTY_OUTPUT", errorMessage: "模型未返回任何文本" } });
      });
    } catch (error) {
      // A final step is an atomic receipt for this response, including empty output.
      try {
        const receipt = await prisma.generationStep.findFirst({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: { in: ["SUCCEEDED", "FAILED", "SKIPPED"] } }, select: { status: true } });
        if (receipt) return;
      } catch { /* Keep original provider/storage classification when verification is unavailable. */ }
      try {
        await prisma.generationStep.updateMany({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), latencyMs: Date.now() - started, errorMessage: error instanceof ChapterSourceChanged ? "来源正文已变化，本次候选未采用" : "改写或润色未完成，未取得可采纳候选" } });
      } catch { /* Cleanup cannot replace the original error. */ }
      throw error;
    }
  };
}
