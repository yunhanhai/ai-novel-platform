import type { PrismaClient } from "@ai-novel/db";
import { lockOutlineProject } from "@ai-novel/db/outline-source";
import { OutlineConflictError, outlineRevisionHash, requireOutlineBase, withOutlineRevision } from "./outline-revision";
export { OutlineConflictError, outlineRevisionHash } from "./outline-revision";

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
    const created = await tx.outline.create({
      data: {
        organizationId, projectId, parentId, level, title, orderIndex,
        status: "PLANNED", createdById,
        ...(summary !== undefined ? { summary } : {})
      }
    });
    return withOutlineRevision(created);
  });
}

export async function findOutlinesByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  const nodes = await prisma.outline.findMany({
    where: { organizationId, projectId, project: { organizationId, deletedAt: null } },
    orderBy: { orderIndex: "asc" }
  });
  return nodes.map(withOutlineRevision);
}

export async function getOutline(organizationId: string, outlineId: string, prisma: PrismaClient) {
  const node = await prisma.outline.findFirst({ where: { id: outlineId, organizationId, project: { organizationId, deletedAt: null } } });
  return node ? withOutlineRevision(node) : null;
}

export async function updateOutline(organizationId: string, outlineId: string, data: UpdateOutlineInput, prisma: PrismaClient, baseRevisionHash: string) {
  requireOutlineBase(baseRevisionHash);
  const source = await prisma.outline.findFirst({ where: { id: outlineId, organizationId }, select: { projectId: true } });
  if (!source) throw new Error("大纲条目不存在");
  return prisma.$transaction(async tx => {
    await lockOutlineProject({ tx, organizationId, projectId: source.projectId });
    const current = await tx.outline.findFirst({ where: { id: outlineId, organizationId, projectId: source.projectId } });
    if (!current) throw new Error("大纲条目不存在");
    const patch = {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
      ...(data.status !== undefined ? { status: data.status } : {})
    };
    if (Object.entries(patch).every(([key, value]) => current[key as keyof typeof patch] === value)) return withOutlineRevision(current);
    if (outlineRevisionHash(current) !== baseRevisionHash.toLowerCase()) throw new OutlineConflictError();
    const updated = await tx.outline.update({ where: { id: outlineId, organizationId, projectId: source.projectId }, data: patch });
    return withOutlineRevision(updated);
  });
}

export async function deleteOutline(organizationId: string, outlineId: string, prisma: PrismaClient, baseRevisionHash: string) {
  requireOutlineBase(baseRevisionHash);
  const source = await prisma.outline.findFirst({ where: { id: outlineId, organizationId }, select: { projectId: true } });
  if (!source) throw new Error("大纲条目不存在");
  return prisma.$transaction(async tx => {
    await lockOutlineProject({ tx, organizationId, projectId: source.projectId });
    const current = await tx.outline.findFirst({ where: { id: outlineId, organizationId, projectId: source.projectId } });
    if (!current) throw new Error("大纲条目不存在");
    if (outlineRevisionHash(current) !== baseRevisionHash.toLowerCase()) throw new OutlineConflictError();
    return tx.outline.delete({ where: { id: outlineId, organizationId, projectId: source.projectId } });
  });
}
