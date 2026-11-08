import type { PrismaClient } from "@ai-novel/db";
import { lockOutlineProject } from "@ai-novel/db/outline-source";

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
  return prisma.$transaction(async tx => {
    await lockOutlineProject({ tx, organizationId, projectId });
    if (parentId) {
      const parent = await tx.outline.findFirst({ where: { id: parentId, organizationId, projectId }, select: { id: true } });
      if (!parent) throw new Error("父级大纲不存在或不属于当前项目");
    }
    return tx.outline.create({
      data: {
        organizationId, projectId, parentId, level, title, orderIndex,
        status: "PLANNED", createdById,
        ...(summary !== undefined ? { summary } : {})
      }
    });
  });
}

export async function findOutlinesByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.outline.findMany({
    where: { organizationId, projectId },
    orderBy: { orderIndex: "asc" }
  });
}

export async function updateOutline(organizationId: string, outlineId: string, data: UpdateOutlineInput, prisma: PrismaClient) {
  const source = await prisma.outline.findFirst({ where: { id: outlineId, organizationId }, select: { projectId: true } });
  if (!source) throw new Error("大纲条目不存在");
  return prisma.$transaction(async tx => {
    await lockOutlineProject({ tx, organizationId, projectId: source.projectId });
    const current = await tx.outline.findFirst({ where: { id: outlineId, organizationId, projectId: source.projectId }, select: { id: true } });
    if (!current) throw new Error("大纲条目不存在");
    return tx.outline.update({ where: { id: outlineId, organizationId, projectId: source.projectId }, data });
  });
}

export async function deleteOutline(organizationId: string, outlineId: string, prisma: PrismaClient) {
  const source = await prisma.outline.findFirst({ where: { id: outlineId, organizationId }, select: { projectId: true } });
  if (!source) throw new Error("大纲条目不存在");
  return prisma.$transaction(async tx => {
    await lockOutlineProject({ tx, organizationId, projectId: source.projectId });
    const current = await tx.outline.findFirst({ where: { id: outlineId, organizationId, projectId: source.projectId }, select: { id: true } });
    if (!current) throw new Error("大纲条目不存在");
    return tx.outline.delete({ where: { id: outlineId, organizationId, projectId: source.projectId } });
  });
}
