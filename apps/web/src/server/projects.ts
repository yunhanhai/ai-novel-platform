import type { PrismaClient } from "@ai-novel/db";

interface CreateProjectParams {
  organizationId: string;
  title: string;
  slug: string;
  createdById: string;
  type?: "LONG_NOVEL" | "SHORT_STORY";
  genre?: string;
  premise?: string;
  styleBrief?: string;
  prisma: PrismaClient;
}

interface UpdateProjectInput {
  title?: string;
  genre?: string;
  styleBrief?: string;
  premise?: string;
  status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
}

export async function createProject({ organizationId, title, slug, createdById, type, genre, premise, styleBrief, prisma }: CreateProjectParams) {
  try {
    return await prisma.project.create({
      data: {
        organizationId, title, slug, createdById,
        type: type ?? "LONG_NOVEL",
        status: "DRAFT",
        ...(genre ? { genre } : {}),
        ...(premise ? { premise } : {}),
        ...(styleBrief ? { styleBrief } : {})
      }
    });
  } catch (error: unknown) {
    if (isPrismaUniqueError(error)) {
      throw new Error("项目标识已被占用");
    }
    throw error;
  }
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
