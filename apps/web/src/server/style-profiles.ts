import type { PrismaClient } from "@ai-novel/db";

// 接受 worker 端 analyzer 算好的统计结果，避免在 web 端重复实现纯函数
export interface StyleStatsInput {
  sentenceLengthProfile?: { avg: number; min: number; max: number; p50: number; p90: number };
  dialogueRatio?: number;
  descriptionDensity?: number;
}

interface CreateStyleProfileParams {
  organizationId: string;
  projectId: string;
  name: string;
  styleBrief?: string;
  referenceTexts?: string[];
  bannedWords?: string[];
  preferredWords?: string[];
  rhythmNotes?: string;
  stats?: StyleStatsInput;
  prisma: PrismaClient;
}

interface UpdateStyleProfileInput {
  styleBrief?: string;
  bannedWords?: string[];
  preferredWords?: string[];
  rhythmNotes?: string;
  stats?: StyleStatsInput;
  isActive?: boolean;
}

export async function createStyleProfile(params: CreateStyleProfileParams) {
  const { organizationId, projectId, name, prisma, ...rest } = params;
  try {
    return await prisma.styleProfile.create({
      data: {
        organizationId,
        projectId,
        name,
        ...buildOptionalFields(rest)
      }
    });
  } catch (error: unknown) {
    if (isPrismaUniqueError(error)) {
      throw new Error("风格画像名称在项目内已存在");
    }
    throw error;
  }
}

export async function findStyleProfilesByProject(
  organizationId: string,
  projectId: string,
  prisma: PrismaClient
) {
  return prisma.styleProfile.findMany({
    where: { organizationId, projectId },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
  });
}

export async function findActiveStyleProfile(
  organizationId: string,
  projectId: string,
  prisma: PrismaClient
) {
  return prisma.styleProfile.findFirst({
    where: { organizationId, projectId, isActive: true },
    orderBy: { updatedAt: "desc" }
  });
}

export async function updateStyleProfile(
  organizationId: string,
  styleProfileId: string,
  data: UpdateStyleProfileInput,
  prisma: PrismaClient
) {
  return prisma.styleProfile.update({
    where: { id: styleProfileId, organizationId },
    data: buildOptionalFields(data)
  });
}

export async function deactivateStyleProfile(
  organizationId: string,
  styleProfileId: string,
  prisma: PrismaClient
) {
  return prisma.styleProfile.update({
    where: { id: styleProfileId, organizationId },
    data: { isActive: false }
  });
}

// 将风格画像的 bannedWords 同步成 deslop_rules，让现有去 AI 味引擎自动读到
export async function syncDeslopRulesFromStyleProfile(
  organizationId: string,
  styleProfileId: string,
  prisma: PrismaClient
): Promise<{ created: number; skipped: number }> {
  const profile = await prisma.styleProfile.findUnique({
    where: { id: styleProfileId, organizationId }
  });
  if (!profile) {
    throw new Error("风格画像不存在");
  }

  const banned = asStringArray(profile.bannedWords);
  if (banned.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const existing = await prisma.deslopRule.findMany({
    where: {
      organizationId,
      projectId: profile.projectId,
      ruleType: "exact_match",
      category: "style_banned"
    },
    select: { pattern: true }
  });
  const existingPatterns = new Set(existing.map((r) => r.pattern));

  const toCreate = banned.filter((w) => !existingPatterns.has(w));
  if (toCreate.length === 0) {
    return { created: 0, skipped: banned.length };
  }

  await prisma.deslopRule.createMany({
    data: toCreate.map((word) => ({
      organizationId,
      projectId: profile.projectId,
      ruleType: "exact_match",
      pattern: word,
      category: "style_banned",
      severity: "warning",
      suggestion: `风格画像「${profile.name}」禁用此词`
    }))
  });

  return { created: toCreate.length, skipped: banned.length - toCreate.length };
}

// 将一章新统计指数加权合并进现有 profile，让风格画像越写越准
// 公式: merged = old * (1 - weight) + new * weight；缺失字段直接用新值
export async function refineStyleProfileFromStats(
  organizationId: string,
  styleProfileId: string,
  newStats: StyleStatsInput,
  prisma: PrismaClient,
  options: { weight?: number } = {}
) {
  const weight = clampWeight(options.weight ?? 0.3);
  const profile = await prisma.styleProfile.findUnique({
    where: { id: styleProfileId, organizationId }
  });
  if (!profile) {
    throw new Error("风格画像不存在");
  }

  const merged = mergeStats(
    {
      sentenceLengthProfile: parseSentenceProfile(profile.sentenceLengthProfile),
      dialogueRatio: parseDecimal(profile.dialogueRatio),
      descriptionDensity: parseDecimal(profile.descriptionDensity)
    },
    newStats,
    weight
  );

  return prisma.styleProfile.update({
    where: { id: styleProfileId, organizationId },
    data: {
      ...(merged.sentenceLengthProfile ? { sentenceLengthProfile: merged.sentenceLengthProfile } : {}),
      ...(merged.dialogueRatio !== undefined ? { dialogueRatio: merged.dialogueRatio } : {}),
      ...(merged.descriptionDensity !== undefined ? { descriptionDensity: merged.descriptionDensity } : {})
    }
  });
}

function clampWeight(w: number): number {
  if (Number.isNaN(w)) return 0.3;
  return Math.max(0, Math.min(1, w));
}

function mergeStats(
  old: StyleStatsInput,
  next: StyleStatsInput,
  weight: number
): StyleStatsInput {
  const result: StyleStatsInput = {};

  if (next.sentenceLengthProfile) {
    if (old.sentenceLengthProfile) {
      result.sentenceLengthProfile = {
        avg: blendInt(old.sentenceLengthProfile.avg, next.sentenceLengthProfile.avg, weight),
        min: blendInt(old.sentenceLengthProfile.min, next.sentenceLengthProfile.min, weight),
        max: blendInt(old.sentenceLengthProfile.max, next.sentenceLengthProfile.max, weight),
        p50: blendInt(old.sentenceLengthProfile.p50, next.sentenceLengthProfile.p50, weight),
        p90: blendInt(old.sentenceLengthProfile.p90, next.sentenceLengthProfile.p90, weight)
      };
    } else {
      result.sentenceLengthProfile = next.sentenceLengthProfile;
    }
  }

  if (next.dialogueRatio !== undefined) {
    result.dialogueRatio = old.dialogueRatio !== undefined
      ? round2(old.dialogueRatio * (1 - weight) + next.dialogueRatio * weight)
      : next.dialogueRatio;
  }

  if (next.descriptionDensity !== undefined) {
    result.descriptionDensity = old.descriptionDensity !== undefined
      ? round2(old.descriptionDensity * (1 - weight) + next.descriptionDensity * weight)
      : next.descriptionDensity;
  }

  return result;
}

function blendInt(oldV: number, newV: number, weight: number): number {
  return Math.round(oldV * (1 - weight) + newV * weight);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseSentenceProfile(value: unknown): StyleStatsInput["sentenceLengthProfile"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.avg !== "number") return undefined;
  return {
    avg: v.avg,
    min: typeof v.min === "number" ? v.min : v.avg,
    max: typeof v.max === "number" ? v.max : v.avg,
    p50: typeof v.p50 === "number" ? v.p50 : v.avg,
    p90: typeof v.p90 === "number" ? v.p90 : v.avg
  };
}

function parseDecimal(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  // Prisma Decimal 对象有 toNumber 方法
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const fn = (value as { toNumber: () => number }).toNumber;
    if (typeof fn === "function") return fn.call(value);
  }
  return undefined;
}

function buildOptionalFields(input: {
  styleBrief?: string;
  referenceTexts?: string[];
  bannedWords?: string[];
  preferredWords?: string[];
  rhythmNotes?: string;
  stats?: StyleStatsInput;
  isActive?: boolean;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.styleBrief !== undefined) data.styleBrief = input.styleBrief;
  if (input.referenceTexts !== undefined) data.referenceTexts = input.referenceTexts;
  if (input.bannedWords !== undefined) data.bannedWords = input.bannedWords;
  if (input.preferredWords !== undefined) data.preferredWords = input.preferredWords;
  if (input.rhythmNotes !== undefined) data.rhythmNotes = input.rhythmNotes;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.stats) {
    if (input.stats.sentenceLengthProfile) {
      data.sentenceLengthProfile = input.stats.sentenceLengthProfile;
    }
    if (input.stats.dialogueRatio !== undefined) {
      data.dialogueRatio = input.stats.dialogueRatio;
    }
    if (input.stats.descriptionDensity !== undefined) {
      data.descriptionDensity = input.stats.descriptionDensity;
    }
  }
  return data;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
