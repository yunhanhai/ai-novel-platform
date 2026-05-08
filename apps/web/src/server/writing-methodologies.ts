import type { PrismaClient } from "@ai-novel/db";
import {
  getMethodologyTemplate,
  type MethodType
} from "@ai-novel/shared/methodology/templates";

interface CreateMethodologyParams {
  organizationId: string;
  projectId: string;
  name: string;
  methodType: string;
  description?: string;
  outlineMetadata?: Record<string, unknown>;
  reviewCriteria?: Record<string, unknown>;
  prisma: PrismaClient;
}

interface CreateFromTemplateParams {
  organizationId: string;
  projectId: string;
  methodType: MethodType;
  name?: string;            // 默认使用模板名称
  prisma: PrismaClient;
}

interface UpdateMethodologyInput {
  description?: string;
  outlineMetadata?: Record<string, unknown>;
  reviewCriteria?: Record<string, unknown>;
  isActive?: boolean;
}

export async function createMethodology(params: CreateMethodologyParams) {
  const { organizationId, projectId, name, methodType, prisma, ...rest } = params;
  try {
    return await prisma.writingMethodology.create({
      data: {
        organizationId,
        projectId,
        name,
        methodType,
        ...buildOptionalFields(rest)
      }
    });
  } catch (error: unknown) {
    if (isPrismaUniqueError(error)) {
      throw new Error("方法论名称在项目内已存在");
    }
    throw error;
  }
}

// 选 6 种内置模板之一，一键填入 description / outlineMetadata / reviewCriteria
export async function createMethodologyFromTemplate(params: CreateFromTemplateParams) {
  const { organizationId, projectId, methodType, name, prisma } = params;
  if (methodType === "custom") {
    throw new Error("custom 类型没有内置模板，请使用 createMethodology");
  }

  const template = getMethodologyTemplate(methodType);
  return createMethodology({
    organizationId,
    projectId,
    name: name ?? template.name,
    methodType: template.methodType,
    description: template.description,
    outlineMetadata: template.outlineMetadata as unknown as Record<string, unknown>,
    reviewCriteria: template.reviewCriteria as unknown as Record<string, unknown>,
    prisma
  });
}

export async function findMethodologiesByProject(
  organizationId: string,
  projectId: string,
  prisma: PrismaClient
) {
  return prisma.writingMethodology.findMany({
    where: { organizationId, projectId },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
  });
}

export async function findActiveMethodology(
  organizationId: string,
  projectId: string,
  prisma: PrismaClient
) {
  return prisma.writingMethodology.findFirst({
    where: { organizationId, projectId, isActive: true },
    orderBy: { updatedAt: "desc" }
  });
}

export async function updateMethodology(
  organizationId: string,
  methodologyId: string,
  data: UpdateMethodologyInput,
  prisma: PrismaClient
) {
  return prisma.writingMethodology.update({
    where: { id: methodologyId, organizationId },
    data: buildOptionalFields(data)
  });
}

export async function deactivateMethodology(
  organizationId: string,
  methodologyId: string,
  prisma: PrismaClient
) {
  return prisma.writingMethodology.update({
    where: { id: methodologyId, organizationId },
    data: { isActive: false }
  });
}

function buildOptionalFields(input: {
  description?: string;
  outlineMetadata?: Record<string, unknown>;
  reviewCriteria?: Record<string, unknown>;
  isActive?: boolean;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description;
  if (input.outlineMetadata !== undefined) data.outlineMetadata = input.outlineMetadata;
  if (input.reviewCriteria !== undefined) data.reviewCriteria = input.reviewCriteria;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
