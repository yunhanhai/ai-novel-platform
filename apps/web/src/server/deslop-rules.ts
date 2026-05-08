import type { PrismaClient } from "@ai-novel/db";

interface CreateRuleParams {
  organizationId: string;
  projectId: string;
  ruleType: "exact_match" | "regex" | "frequency" | "sentence_pattern";
  pattern: string;
  category: string;
  severity?: "info" | "warning" | "error";
  suggestion?: string;
  genre?: string;
  prisma: PrismaClient;
}

export async function createDeslopRule(params: CreateRuleParams) {
  const { organizationId, projectId, ruleType, pattern, category, prisma, ...rest } = params;
  return prisma.deslopRule.create({
    data: {
      organizationId, projectId, ruleType, pattern, category,
      severity: rest.severity ?? "warning",
      ...(rest.suggestion ? { suggestion: rest.suggestion } : {}),
      ...(rest.genre ? { genre: rest.genre } : {})
    }
  });
}

export async function findDeslopRulesByProject(
  organizationId: string,
  projectId: string,
  prisma: PrismaClient,
  filters: { isActive?: boolean; category?: string } = {}
) {
  return prisma.deslopRule.findMany({
    where: {
      organizationId, projectId,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.category ? { category: filters.category } : {})
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }]
  });
}

interface UpdateRuleInput {
  pattern?: string;
  severity?: "info" | "warning" | "error";
  suggestion?: string;
  isActive?: boolean;
  category?: string;
}

export async function updateDeslopRule(
  organizationId: string,
  ruleId: string,
  data: UpdateRuleInput,
  prisma: PrismaClient
) {
  return prisma.deslopRule.update({
    where: { id: ruleId, organizationId },
    data: {
      ...(data.pattern !== undefined ? { pattern: data.pattern } : {}),
      ...(data.severity !== undefined ? { severity: data.severity } : {}),
      ...(data.suggestion !== undefined ? { suggestion: data.suggestion } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.category !== undefined ? { category: data.category } : {})
    }
  });
}

export async function deactivateDeslopRule(
  organizationId: string,
  ruleId: string,
  prisma: PrismaClient
) {
  return prisma.deslopRule.update({
    where: { id: ruleId, organizationId },
    data: { isActive: false }
  });
}
