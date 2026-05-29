import type { PrismaClient } from "@ai-novel/db";
import { normalizeContextOptions, resolveTokenBudget } from "@ai-novel/shared/context-composer/options";
import type { ContextAsset, ContextOptions, ContextBudgetPreset } from "@ai-novel/shared/context-composer/types";
import { buildContextPacket } from "@ai-novel/shared/context-composer/build-context-packet";

interface BuildPreviewParams {
  organizationId: string;
  chapterId: string;
  rawOptions?: ContextOptions;
  prisma: PrismaClient;
}

export interface ChapterContextPreview {
  chapterId: string;
  projectId: string;
  budgetPreset: ContextBudgetPreset;
  tokenBudget: number;
  estimatedTokens: number;
  included: ContextAsset[];
  trimmed: ContextAsset[];
  available: ContextAsset[];
  excluded: ContextAsset[];
  forced: ContextAsset[];
  required: ContextAsset[];
  promptPreview: string;
  activationReport: unknown;
  warnings: string[];
}

export async function buildChapterContextPreview({
  organizationId,
  chapterId,
  rawOptions,
  prisma
}: BuildPreviewParams): Promise<ChapterContextPreview | null> {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, organizationId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      chapterNo: true,
      title: true,
      outlineSummary: true,
      project: { select: { title: true, styleBrief: true } },
      targetOutlines: {
        select: { summary: true },
        orderBy: { orderIndex: "asc" },
        take: 1
      }
    }
  });
  if (!chapter) return null;

  const options = normalizeContextOptions(rawOptions);
  const tokenBudget = resolveTokenBudget(options.budgetPreset);
  const [characters, worldItems, plotThreads, memories, styleProfile, methodology] = await Promise.all([
    prisma.character.findMany({
      where: { organizationId, projectId: chapter.projectId, status: "active", deletedAt: null },
      orderBy: { createdAt: "asc" }
    }),
    prisma.worldItem.findMany({
      where: { organizationId, projectId: chapter.projectId, status: "active", deletedAt: null },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }]
    }),
    prisma.plotThread.findMany({
      where: {
        organizationId,
        projectId: chapter.projectId,
        deletedAt: null,
        status: { in: ["planted", "progressing", "deferred"] }
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }]
    }),
    prisma.projectMemory.findMany({
      where: { organizationId, projectId: chapter.projectId, status: "accepted" },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.styleProfile.findFirst({
      where: { organizationId, projectId: chapter.projectId, isActive: true },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.writingMethodology.findFirst({
      where: { organizationId, projectId: chapter.projectId, isActive: true },
      orderBy: { updatedAt: "desc" }
    })
  ]);

  const packet = buildContextPacket({
    projectId: chapter.projectId,
    projectTitle: chapter.project.title,
    styleBrief: chapter.project.styleBrief ?? undefined,
    currentChapter: {
      id: chapter.id,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      outlineSummary: chapter.outlineSummary ?? chapter.targetOutlines[0]?.summary ?? undefined
    },
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
      roleType: character.roleType,
      personality: character.personality ?? undefined,
      speechPattern: character.speechPattern ?? undefined,
      content: compactLines([
        character.motivation ? `motivation: ${character.motivation}` : "",
        character.appearance ? `appearance: ${character.appearance}` : "",
        character.arc ? `arc: ${character.arc}` : "",
        character.constraints ? `constraints: ${character.constraints}` : ""
      ])
    })),
    worldItems: worldItems.map((item) => ({
      id: item.id,
      name: item.name,
      itemType: item.itemType,
      content: compactLines([item.summary ?? "", item.detail ?? "", item.constraints ? `constraints: ${item.constraints}` : ""]),
      activationKeywords: asStringArray(item.activationKeywords, [item.name])
    })),
    plotThreads: plotThreads.map((thread) => ({
      id: thread.id,
      threadType: thread.threadType,
      title: thread.title,
      content: thread.description ?? "",
      status: thread.status
    })),
    recentMemories: memories.map((memory) => ({
      memoryType: memory.memoryType,
      content: memory.content,
      scopeType: memory.scopeType,
      sourceChapterId: memory.sourceChapterId
    })),
    tokenBudget,
    styleGuide: styleProfile
      ? {
          brief: styleProfile.styleBrief ?? undefined,
          banned: asStringArray(styleProfile.bannedWords),
          preferred: asStringArray(styleProfile.preferredWords),
          sentenceTarget: parseSentenceTarget(styleProfile.sentenceLengthProfile)
        }
      : undefined,
    methodologyGuide: methodology
      ? {
          name: methodology.name,
          methodType: methodology.methodType,
          guideText: renderMethodologyGuide(methodology.outlineMetadata),
          reviewCriteria: parseReviewCriteria(methodology.reviewCriteria)
        }
      : undefined,
    contextOptions: options
  });

  return {
    chapterId: chapter.id,
    projectId: chapter.projectId,
    budgetPreset: options.budgetPreset,
    tokenBudget,
    estimatedTokens: packet.assets.estimatedTokens,
    included: packet.assets.included,
    trimmed: packet.assets.trimmed,
    available: packet.assets.available,
    excluded: packet.assets.excluded,
    forced: packet.assets.forced,
    required: packet.assets.required,
    promptPreview: packet.prompt,
    activationReport: packet.activationReport,
    warnings: []
  };
}

function compactLines(values: string[]): string {
  return values.filter((value) => value.trim().length > 0).join("\n");
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function parseSentenceTarget(value: unknown): { avg: number; min: number; max: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.avg !== "number") return undefined;
  return {
    avg: record.avg,
    min: typeof record.min === "number" ? record.min : record.avg,
    max: typeof record.max === "number" ? record.max : record.avg
  };
}

function renderMethodologyGuide(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const nodes = (value as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return "";
  return nodes
    .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === "object")
    .map((node) => {
      const level = typeof node.level === "string" ? node.level : "node";
      const title = typeof node.title === "string" ? node.title : "";
      const summary = typeof node.summary === "string" ? node.summary : "";
      return `[${level}] ${title}: ${summary}`.trim();
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseReviewCriteria(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...asStringArray(record.structureChecks),
    ...asStringArray(record.pacingChecks),
    ...asStringArray(record.forbiddenMoves)
  ];
}
