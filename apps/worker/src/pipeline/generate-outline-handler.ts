import type { PrismaClient, Prisma } from "@ai-novel/db";
import { lockOutlineProject, readOutlineSource } from "@ai-novel/db/outline-source";
import { createHash } from "node:crypto";
import { createFakeModel } from "./fake-model";
import { recordModelUsage } from "./usage-recorder";
import { OutlineSourceChanged } from "./outline-generation-source";
import type { GenerationJob, UpdateStatusFn } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;
interface HandlerDeps { prisma: PrismaClient; updateJobStatus: UpdateStatusFn; model?: FakeModel; resolveModel?: (job: GenerationJob) => Promise<FakeModel | null> }
interface OutlineInput { chapterCount?: unknown; instruction?: unknown; projectId?: unknown }
interface DraftedChapter { title: string; summary: string }
export const MAX_OUTLINE_PROMPT_CHARS = 40000;
const INVALID_OUTPUT = "模型未返回完整有效的章节细纲 JSON，请重新生成；未追加任何条目";
const DEFAULT_CHAPTER_COUNT = 5, MAX_CHAPTER_COUNT = 20;
export function normalizeChapterCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHAPTER_COUNT;
  return Math.max(1, Math.min(Math.round(parsed), MAX_CHAPTER_COUNT));
}
export function buildOutlinePrompt(params: { projectTitle: string; premise: string | null; genre: string | null; styleBrief: string | null; existingChapters: Array<{ title: string; summary: string | null }>; characterNames: string[]; worldNames: string[]; chapterCount: number; instruction?: string }): string {
  const existing = params.existingChapters.length ? params.existingChapters.map((item, index) => `${index + 1}. ${item.title}${item.summary ? `：${item.summary}` : ""}`).join("\n") : "（暂无已有章节细纲）";
  return [`你是资深中文网文策划编辑。请为作品《${params.projectTitle}》设计接下来的 ${params.chapterCount} 章章节细纲。`,
    params.premise ? `故事梗概：${params.premise}` : "", params.genre ? `题材类型：${params.genre}` : "", params.styleBrief ? `风格基调：${params.styleBrief}` : "",
    params.characterNames.length ? `主要角色：${params.characterNames.join("、")}` : "", params.worldNames.length ? `关键设定：${params.worldNames.join("、")}` : "",
    "已有的章节细纲（新细纲必须接续它们，不要重复）：", existing, "要求：",
    `- 必须正好返回 ${params.chapterCount} 章，每章标题1-200字符、摘要1-1000字符；细纲建议80-150字，包含核心事件、冲突推进与结尾钩子`,
    "- 章节之间有因果递进，节奏有起伏，与已有细纲自然衔接，不推翻已发生情节",
    params.instruction ? `- 额外要求：${params.instruction}` : "", "只返回 JSON，不要任何解释：", '{"chapters":[{"title":"章节标题","summary":"章节细纲"}]}'].filter(Boolean).join("\n");
}
export function normalizeDraftedChapters(raw: unknown, limit: number): DraftedChapter[] {
  if (!Array.isArray(raw) || raw.length !== limit) return [];
  const result: DraftedChapter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.summary !== "string") return [];
    const title = item.title.trim(), summary = item.summary.trim();
    if (!title || title.length > 200 || !summary || summary.length > 1000) return [];
    result.push({ title, summary });
  }
  return result;
}
function parseDrafts(text: string, count: number): DraftedChapter[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/i, "$1");
  let parsed: unknown; try { parsed = JSON.parse(cleaned); } catch { return []; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return normalizeDraftedChapters((parsed as Record<string, unknown>).chapters, count);
}
const sourceHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createGenerateOutlineHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  return async function handle(job: GenerationJob): Promise<void> {
    if (job.jobType !== "GENERATE_OUTLINE") return;
    const current = await prisma.generationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, projectId: job.projectId, jobType: "GENERATE_OUTLINE" }, select: { status: true, attemptCount: true } });
    if (!current || current.status !== "RUNNING" || current.attemptCount !== (job.attemptCount ?? 1)) return;
    const fail = (errorCode: string, errorMessage: string) => updateJobStatus({ jobId: job.id, status: "FAILED", errorCode, errorMessage, expectedStatus: "RUNNING", expectedAttemptCount: job.attemptCount ?? 1 });
    const input = (job.input ?? {}) as OutlineInput;
    if (job.targetEntityType !== "PROJECT" || job.targetEntityId !== job.projectId || (typeof input.projectId === "string" && input.projectId !== job.projectId)) { await fail("PROJECT_TARGET_MISMATCH", "细纲任务目标与项目不一致，请重新发起"); return; }
    let source: { project: Awaited<ReturnType<typeof lockOutlineProject>>; outlines: Awaited<ReturnType<typeof readOutlineSource>> };
    try {
      source = await prisma.$transaction(async tx => ({ project: await lockOutlineProject({ tx, organizationId: job.organizationId, projectId: job.projectId }), outlines: await readOutlineSource({ tx, organizationId: job.organizationId, projectId: job.projectId }) }));
    } catch (error) { if (error instanceof Error && error.message === "项目不存在或不属于当前组织") { await fail("PROJECT_NOT_FOUND", "项目不存在或不属于当前组织"); return; } throw error; }
    const chapterCount = normalizeChapterCount(input.chapterCount);
    const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
    const [characters, worldItems] = await Promise.all([
      prisma.character.findMany({ where: { organizationId: job.organizationId, projectId: job.projectId }, select: { name: true }, orderBy: { id: "asc" }, take: 20 }),
      prisma.worldItem.findMany({ where: { organizationId: job.organizationId, projectId: job.projectId }, select: { name: true }, orderBy: { id: "asc" }, take: 20 })
    ]);
    const prompt = buildOutlinePrompt({ projectTitle: source.project.title, premise: source.project.premise, genre: source.project.genre, styleBrief: source.project.styleBrief, existingChapters: source.outlines.filter(row => row.level === "CHAPTER"), characterNames: characters.map(row => row.name), worldNames: worldItems.map(row => row.name), chapterCount, instruction: instruction || undefined });
    let promptChars = 0;
    for (const _ of prompt) { if (++promptChars > MAX_OUTLINE_PROMPT_CHARS) { await fail("OUTLINE_SOURCE_TOO_LONG", `本次细纲上下文超过${MAX_OUTLINE_PROMPT_CHARS}字符，请精简后重新生成；未追加条目`); return; } }
    let model = deps.model ?? createFakeModel();
    if (deps.resolveModel) { const resolved = await deps.resolveModel(job); if (resolved) model = resolved; else if (!deps.model) { await fail("NO_MODEL_PROFILE", "无法解析 ModelProfile 且未配置兜底模型"); return; } }
    const capturedHash = sourceHash(source);
    const step = await prisma.generationStep.create({ data: { organizationId: job.organizationId, jobId: job.id, stepKey: "generate_outline", status: "RUNNING", startedAt: new Date(), promptSnapshot: prompt.slice(0, 4000) }, select: { id: true } });
    const started = Date.now();
    try {
      const result = await model.generate(prompt, { responseFormat: "json_object" });
      const latencyMs = Date.now() - started;
      await recordModelUsage({ prisma, job, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs });
      const drafted = parseDrafts(result.text, chapterCount);
      await prisma.$transaction(async tx => {
        let latest: typeof source;
        try { latest = { project: await lockOutlineProject({ tx, organizationId: job.organizationId, projectId: job.projectId }), outlines: await readOutlineSource({ tx, organizationId: job.organizationId, projectId: job.projectId }) }; }
        catch (error) { if (error instanceof Error && error.message === "项目不存在或不属于当前组织") throw new OutlineSourceChanged(); throw error; }
        const jobs = await tx.$queryRaw<Array<{ status: string; attemptCount: number }>>`
          SELECT upper(status::text) AS status, attempt_count AS "attemptCount" FROM generation_jobs
          WHERE id = ${job.id}::uuid AND organization_id = ${job.organizationId}::uuid
            AND project_id = ${job.projectId}::uuid AND job_type = 'generate_outline' FOR UPDATE
        `;
        if (!jobs[0] || jobs[0].status !== "RUNNING" || jobs[0].attemptCount !== (job.attemptCount ?? 1)) {
          await tx.generationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", finishedAt: new Date(), latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, outputPreview: "任务已取消、结束或执行已更新，未追加本次细纲" } }); return;
        }
        if (sourceHash(latest) !== capturedHash) throw new OutlineSourceChanged();
        const finishedAt = new Date();
        if (!drafted.length) {
          await tx.generationStep.update({ where: { id: step.id }, data: { status: "FAILED", finishedAt, latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, errorMessage: INVALID_OUTPUT } });
          await tx.generationJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt, errorCode: "INVALID_MODEL_OUTPUT", errorMessage: INVALID_OUTPUT } }); return;
        }
        const parent = latest.outlines.find(row => row.level === "VOLUME");
        let orderIndex = latest.outlines.filter(row => row.level === "CHAPTER").reduce((max, row) => Math.max(max, row.orderIndex), 0);
        const created: Array<{ id: string; title: string; orderIndex: number }> = [];
        for (const chapter of drafted) {
          created.push(await tx.outline.create({ data: { organizationId: job.organizationId, projectId: job.projectId, parentId: parent?.id ?? null, level: "CHAPTER", title: chapter.title, summary: chapter.summary, orderIndex: ++orderIndex, status: "PLANNED", createdById: job.userId, metadata: { source: "GENERATE_OUTLINE", jobId: job.id } }, select: { id: true, title: true, orderIndex: true } }));
        }
        await tx.generationStep.update({ where: { id: step.id }, data: { status: "SUCCEEDED", finishedAt, outputPreview: `created=${created.length}`, latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens } });
        await tx.generationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", progress: "100", finishedAt, errorCode: null, errorMessage: null, output: { projectId: job.projectId, sourceSha256: capturedHash, createdCount: created.length, requestedCount: chapterCount, outlines: created } as Prisma.InputJsonValue } });
      });
    } catch (error) {
      try { const receipt = await prisma.generationStep.findFirst({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: { in: ["SUCCEEDED", "FAILED", "SKIPPED"] } }, select: { status: true } }); if (receipt) return; } catch { /* Preserve original failure. */ }
      try { await prisma.generationStep.updateMany({ where: { id: step.id, jobId: job.id, organizationId: job.organizationId, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), latencyMs: Date.now() - started, errorMessage: error instanceof OutlineSourceChanged ? "大纲来源已变化，本次细纲未追加" : "细纲生成未完成，未追加有效结果" } }); } catch { /* Preserve provider/storage classification. */ }
      throw error;
    }
  };
}
