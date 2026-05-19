import type { PrismaClient } from "@ai-novel/db";
import { Prisma } from "@ai-novel/db";
import {
  getMethodologyTemplate,
  type MethodType,
  type MethodologyTemplate
} from "@ai-novel/shared/methodology/templates";

type MethodologyValue = MethodType | "none";

export interface WizardOutlineNode {
  level: "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";
  title: string;
  summary?: string;
  orderIndex: number;
}

export interface WizardExtras {
  methodType?: MethodologyValue;
  outlineNodes?: WizardOutlineNode[];
}

interface CreateProjectParams {
  organizationId: string;
  title: string;
  slug: string;
  createdById: string;
  type?: "LONG_NOVEL" | "SHORT_STORY";
  genre?: string;
  premise?: string;
  styleBrief?: string;
  wizard?: WizardExtras;
  prisma: PrismaClient;
}

interface UpdateProjectInput {
  title?: string;
  genre?: string;
  styleBrief?: string;
  premise?: string;
  status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
}

export async function createProject(params: CreateProjectParams) {
  const { organizationId, title, slug, createdById, type, genre, premise, styleBrief, wizard, prisma } = params;
  try {
    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          organizationId, title, slug, createdById,
          type: type ?? "LONG_NOVEL",
          status: "DRAFT",
          ...(genre ? { genre } : {}),
          ...(premise ? { premise } : {}),
          ...(styleBrief ? { styleBrief } : {})
        }
      });

      const methodologyData = buildMethodologyInsert(wizard?.methodType, organizationId, project.id);
      if (methodologyData) {
        await tx.writingMethodology.create({ data: methodologyData });
      }

      const outlines = wizard?.outlineNodes ?? [];
      if (outlines.length > 0) {
        await tx.outline.createMany({
          data: outlines.map((node) => ({
            organizationId,
            projectId: project.id,
            level: node.level,
            title: node.title,
            summary: node.summary ?? null,
            orderIndex: node.orderIndex,
            createdById
          }))
        });
      }

      return project;
    });
  } catch (error: unknown) {
    if (isPrismaUniqueError(error)) {
      throw new Error("项目标识已被占用");
    }
    throw error;
  }
}

function buildMethodologyInsert(
  methodType: MethodologyValue | undefined,
  organizationId: string,
  projectId: string
): Prisma.WritingMethodologyUncheckedCreateInput | null {
  if (!methodType || methodType === "none") return null;

  if (methodType === "custom") {
    return {
      organizationId,
      projectId,
      name: "自定义方法论",
      methodType: "custom",
      description: null,
      outlineMetadata: Prisma.JsonNull,
      reviewCriteria: Prisma.JsonNull,
      isActive: true
    };
  }

  let tmpl: MethodologyTemplate;
  try {
    tmpl = getMethodologyTemplate(methodType);
  } catch {
    return null;
  }

  return {
    organizationId,
    projectId,
    name: tmpl.name,
    methodType: tmpl.methodType,
    description: tmpl.description,
    outlineMetadata: tmpl.outlineMetadata as unknown as Prisma.InputJsonValue,
    reviewCriteria: tmpl.reviewCriteria as unknown as Prisma.InputJsonValue,
    isActive: true
  };
}

export async function findProjectBySlug(organizationId: string, slug: string, prisma: PrismaClient) {
  return prisma.project.findFirst({
    where: { organizationId, slug, deletedAt: null }
  });
}

export async function findProjectsByOrganization(organizationId: string, prisma: PrismaClient) {
  return prisma.project.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { updatedAt: "desc" }
  });
}

export async function softDeleteProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.project.update({
    where: { id: projectId, organizationId },
    data: { deletedAt: new Date() }
  });
}

export async function updateProject(organizationId: string, projectId: string, data: UpdateProjectInput, prisma: PrismaClient) {
  return prisma.project.update({
    where: { id: projectId, organizationId },
    data
  });
}

function isPrismaUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
}
