import type { PrismaClient } from "@ai-novel/db";
import type { PerformanceCostBudget } from "./performance-trends";

export type PerformanceBudgetScope = "ORGANIZATION" | "PROJECT";

export interface PerformanceBudgetInput {
  warningCents?: unknown;
  criticalCents?: unknown;
}

export interface EffectivePerformanceBudget extends PerformanceCostBudget {
  scope: PerformanceBudgetScope | "ENV" | "NONE";
}

export function normalizePerformanceBudgetInput(input: PerformanceBudgetInput): PerformanceCostBudget {
  const warningCents = normalizeBudgetCents(input.warningCents);
  const criticalCents = normalizeBudgetCents(input.criticalCents);
  if (warningCents !== null && criticalCents !== null && criticalCents < warningCents) {
    throw new BudgetValidationError("严重阈值不得小于预警阈值");
  }
  return { warningCents, criticalCents };
}

export async function listPerformanceBudgets(organizationId: string, prisma: PrismaClient) {
  return prisma.performanceBudget.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ scope: "asc" }, { projectId: "asc" }]
  });
}

export async function upsertPerformanceBudget(params: {
  organizationId: string;
  scope: PerformanceBudgetScope;
  projectId?: string | null;
  warningCents?: number | null;
  criticalCents?: number | null;
  prisma: PrismaClient;
}) {
  const projectId = params.scope === "PROJECT" ? params.projectId ?? null : null;
  const data = {
    warningCents: params.warningCents ?? null,
    criticalCents: params.criticalCents ?? null,
    isActive: true
  };

  const where = { organizationId: params.organizationId, scope: params.scope, projectId, isActive: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await params.prisma.performanceBudget.findFirst({ where, select: { id: true } });
    try {
      if (existing) {
        return await params.prisma.performanceBudget.update({ where: { id: existing.id, ...where }, data: { ...data, updatedAt: new Date() } });
      }
      return await params.prisma.performanceBudget.create({ data: { organizationId: params.organizationId, projectId, scope: params.scope, ...data } });
    } catch (error: unknown) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if ((code !== "P2002" && code !== "P2025") || attempt === 2) throw error;
    }
  }
  throw new Error("预算并发更新失败");
}
export async function deactivatePerformanceBudget(params: {
  organizationId: string;
  scope: PerformanceBudgetScope;
  projectId?: string | null;
  prisma: PrismaClient;
}) {
  const projectId = params.scope === "PROJECT" ? params.projectId ?? null : null;
  const existing = await params.prisma.performanceBudget.findFirst({
    where: {
      organizationId: params.organizationId,
      scope: params.scope,
      projectId,
      isActive: true
    },
    select: { id: true }
  });

  if (!existing) return null;

  try {
    return await params.prisma.performanceBudget.update({
      where: { id: existing.id, organizationId: params.organizationId, scope: params.scope, projectId, isActive: true },
      data: { isActive: false, updatedAt: new Date() }
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") return null;
    throw error;
  }
}

export async function getEffectivePerformanceCostBudget(params: {
  organizationId: string;
  projectId?: string | null;
  prisma: PrismaClient;
  fallback?: PerformanceCostBudget;
}): Promise<EffectivePerformanceBudget> {
  let projectBudget: { warningCents: number | null; criticalCents: number | null; scope: PerformanceBudgetScope } | null = null;
  if (params.projectId) {
    projectBudget = await params.prisma.performanceBudget.findFirst({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        scope: "PROJECT",
        isActive: true
      },
      select: { warningCents: true, criticalCents: true, scope: true }
    }) as typeof projectBudget;
  }

  const organizationBudget = await params.prisma.performanceBudget.findFirst({
    where: {
      organizationId: params.organizationId,
      projectId: null,
      scope: "ORGANIZATION",
      isActive: true
    },
    select: { warningCents: true, criticalCents: true, scope: true }
  }) as { warningCents: number | null; criticalCents: number | null; scope: PerformanceBudgetScope } | null;

  const budget = projectBudget ?? organizationBudget;
  if (budget) {
    return {
      scope: budget.scope,
      warningCents: budget.warningCents,
      criticalCents: budget.criticalCents
    };
  }

  if (params.fallback?.warningCents || params.fallback?.criticalCents) {
    return {
      scope: "ENV",
      warningCents: params.fallback.warningCents ?? null,
      criticalCents: params.fallback.criticalCents ?? null
    };
  }

  return { scope: "NONE", warningCents: null, criticalCents: null };
}

export class BudgetValidationError extends Error {}

function normalizeBudgetCents(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw new BudgetValidationError("预算必须为正整数分");
  }
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    throw new BudgetValidationError("预算必须为有效的正整数分");
  }
  return parsed;
}
