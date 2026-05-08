import type { PrismaClient } from "@ai-novel/db";

interface CreateOutlineParams {
  organizationId: string;
  projectId: string;
  parentId?: string;
  level: "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";
  title: string;
  orderIndex: number;
  summary?: string;
  createdById: string;
  prisma: PrismaClient;
}

interface UpdateOutlineInput {
  title?: string;
  summary?: string;
  status?: "PLANNED" | "DRAFTING" | "DONE";
}

export async function createOutline({ organizationId, projectId, parentId, level, title, orderIndex, summary, createdById, prisma }: CreateOutlineParams) {
  return prisma.outline.create({
    data: {
      organizationId, projectId, parentId, level, title, orderIndex,
      status: "PLANNED", createdById,
      ...(summary ? { summary } : {})
    }
  });
}

export async function findOutlinesByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.outline.findMany({
    where: { organizationId, projectId },
    orderBy: { orderIndex: "asc" }
  });
}

export async function updateOutline(organizationId: string, outlineId: string, data: UpdateOutlineInput, prisma: PrismaClient) {
  return prisma.outline.update({
    where: { id: outlineId, organizationId },
    data
  });
}
