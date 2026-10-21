import type { PrismaClient } from "@ai-novel/db";
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

interface OutlineInput {
  chapterCount?: unknown;
  instruction?: unknown;
}

const ERROR_CODES = {
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE",
  EMPTY_OUTPUT: "EMPTY_OUTPUT"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DEFAULT_CHAPTER_COUNT = 5;
const MAX_CHAPTER_COUNT = 20;

export function normalizeChapterCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHAPTER_COUNT;
  return Math.min(Math.round(parsed), MAX_CHAPTER_COUNT);
}

interface DraftedChapter {
  title: string;
  summary: string;
}

export function buildOutlinePrompt(params: {
  projectTitle: string;
  premise: string | null;
  genre: string | null;
  styleBrief: string | null;
  existingChapters: Array<{ title: string; summary: string | null }>;
  characterNames: string[];
  worldNames: string[];
  chapterCount: number;
  instruction?: string;
}): string {
  const { projectTitle, premise, genre, styleBrief, existingChapters, characterNames, worldNames, chapterCount, instruction } = params;

  const existing = existingChapters.length
    ? existingChapters
        .map((item, index) => `${index + 1}. ${item.title}${item.summary ? `：${item.summary.slice(0, 80)}` : ""}`)
        .join("\n")
    : "（暂无已有章节细纲）";

  return [
    `你是资深中文网文策划编辑。请为作品《${projectTitle}》设计接下来的 ${chapterCount} 章章节细纲。`,
    "",
    premise ? `故事梗概：${premise.slice(0, 1200)}` : "",
    genre ? `题材类型：${genre}` : "",
    styleBrief ? `风格基调：${styleBrief.slice(0, 400)}` : "",
    characterNames.length ? `主要角色：${characterNames.slice(0, 20).join("、")}` : "",
    worldNames.length ? `关键设定：${worldNames.slice(0, 20).join("、")}` : "",
    "",
    "已有的章节细纲（新细纲必须接续它们，不要重复）：",
    existing,
    "",
    "要求：",
    "- 每一章给出标题与 80-150 字的细纲，包含该章的核心事件、冲突推进与结尾钩子",
    "- 章节之间要有因果递进，节奏有起伏，避免连续同质化场景",
    "- 与已有细纲自然衔接，不推翻已经发生的情节",
    instruction ? `- 额外要求：${instruction}` : "",
    "",
    "只返回 JSON，不要任何解释：",
    `{"chapters":[{"title":"章节标题","summary":"章节细纲"}]}`
  ]
    .filter((line) => line !== "")
    .join("\n");
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

export function normalizeDraftedChapters(raw: unknown, limit: number): DraftedChapter[] {
  if (!Array.isArray(raw)) return [];
  const result: DraftedChapter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (!title) continue;
    result.push({ title: title.slice(0, 200), summary });
    if (result.length >= limit) break;
  }
  return result;
}

export function createGenerateOutlineHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const input = (job.input ?? {}) as OutlineInput;
    const chapterCount = normalizeChapterCount(input.chapterCount);
    const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";

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

    const project = await prisma.project.findFirst({
      where: { id: job.projectId, organizationId: job.organizationId, deletedAt: null },
      select: { id: true, title: true, premise: true, genre: true, styleBrief: true }
    });
    if (!project) {
      await fail(job.id, ERROR_CODES.PROJECT_NOT_FOUND, `项目 ${job.projectId} 不存在`);
      return;
    }

    const existingOutlines = await prisma.outline.findMany({
      where: { organizationId: job.organizationId, projectId: job.projectId, level: "CHAPTER" },
      orderBy: { orderIndex: "asc" },
      select: { title: true, summary: true, orderIndex: true }
    });

    const [characters, worldItems] = await Promise.all([
      prisma.character.findMany({
        where: { organizationId: job.organizationId, projectId: job.projectId },
        select: { name: true },
        take: 20
      }),
      prisma.worldItem.findMany({
        where: { organizationId: job.organizationId, projectId: job.projectId },
        select: { name: true },
        take: 20
      })
    ]);

    const prompt = buildOutlinePrompt({
      projectTitle: project.title,
      premise: project.premise,
      genre: project.genre,
      styleBrief: project.styleBrief,
      existingChapters: existingOutlines,
      characterNames: characters.map((c) => c.name),
      worldNames: worldItems.map((w) => w.name),
      chapterCount,
      instruction: instruction || undefined
    });

    const step = await prisma.generationStep.create({
      data: {
        organizationId: job.organizationId,
        jobId: job.id,
        stepKey: "generate_outline",
        status: "RUNNING",
        startedAt: new Date()
      },
      select: { id: true }
    });

    const started = Date.now();
    const result = await model.generate(prompt);
    const latencyMs = Date.now() - started;

    const parsed = safeJson<{ chapters?: unknown }>(result.text, {});
    const drafted = normalizeDraftedChapters(parsed.chapters, chapterCount);
    if (drafted.length === 0) {
      await prisma.generationStep.update({
        where: { id: step.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          outputPreview: "no chapters parsed",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs
        }
      });
      await fail(job.id, ERROR_CODES.EMPTY_OUTPUT, "模型未返回可解析的章节细纲");
      return;
    }

    const parent = await prisma.outline.findFirst({
      where: { organizationId: job.organizationId, projectId: job.projectId, level: "VOLUME" },
      orderBy: { orderIndex: "asc" },
      select: { id: true }
    });

    const baseOrder = existingOutlines.reduce((max, item) => Math.max(max, item.orderIndex), 0);

    const created = await prisma.$transaction(async (tx) => {
      const rows = [] as Array<{ id: string; title: string; orderIndex: number }>;
      let orderIndex = baseOrder;
      for (const chapter of drafted) {
        orderIndex += 1;
        const row = await tx.outline.create({
          data: {
            organizationId: job.organizationId,
            projectId: job.projectId,
            parentId: parent?.id ?? null,
            level: "CHAPTER",
            title: chapter.title,
            summary: chapter.summary || null,
            orderIndex,
            status: "PLANNED",
            createdById: job.userId,
            metadata: { source: "GENERATE_OUTLINE", jobId: job.id } as never
          },
          select: { id: true, title: true, orderIndex: true }
        });
        rows.push(row);
      }
      return rows;
    });

    await prisma.generationStep.update({
      where: { id: step.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        outputPreview: `created=${created.length}`,
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
        createdCount: created.length,
        requestedCount: chapterCount,
        outlines: created.map((row) => ({ id: row.id, title: row.title, orderIndex: row.orderIndex }))
      }
    });
  };
}
