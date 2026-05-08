import type { PrismaClient } from "@ai-novel/db";

interface CreateVolumeParams {
  organizationId: string;
  projectId: string;
  title: string;
  orderIndex: number;
  summary?: string;
  prisma: PrismaClient;
}

interface CreateChapterParams {
  organizationId: string;
  projectId: string;
  volumeId?: string;
  chapterNo: number;
  title: string;
  createdById: string;
  prisma: PrismaClient;
}

interface UpdateContentParams {
  organizationId: string;
  chapterId: string;
  content: string;
  wordCount: number;
  updatedById: string;
  prisma: PrismaClient;
}

interface SaveVersionParams {
  organizationId: string;
  projectId: string;
  chapterId: string;
  content: string;
  source: "MANUAL" | "AI" | "IMPORT";
  createdById: string;
  generationJobId?: string;
  prisma: PrismaClient;
}

export async function createVolume({ organizationId, projectId, title, orderIndex, summary, prisma }: CreateVolumeParams) {
  return prisma.volume.create({
    data: {
      organizationId, projectId, title, orderIndex,
      status: "PLANNED",
      ...(summary ? { summary } : {})
    }
  });
}

export async function createChapter({ organizationId, projectId, volumeId, chapterNo, title, createdById, prisma }: CreateChapterParams) {
  return prisma.chapter.create({
    data: {
      organizationId, projectId, volumeId, chapterNo,
      title, createdById, status: "DRAFT", content: "", wordCount: 0
    }
  });
}

export async function updateChapterContent({ chapterId, content, wordCount, updatedById, prisma }: UpdateContentParams) {
  return prisma.chapter.update({
    where: { id: chapterId },
    data: { content, wordCount, updatedById }
  });
}

export async function saveContentVersion({ organizationId, projectId, chapterId, content, source, createdById, generationJobId, prisma }: SaveVersionParams) {
  const latest = await prisma.contentVersion.findFirst({
    where: { entityType: "CHAPTER", entityId: chapterId },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true }
  });

  const nextVersionNo = (latest?.versionNo ?? 0) + 1;

  return prisma.contentVersion.create({
    data: {
      organizationId, projectId, entityType: "CHAPTER", entityId: chapterId,
      versionNo: nextVersionNo, content, source, createdById, generationJobId
    }
  });
}

export async function findChaptersByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.chapter.findMany({
    where: { organizationId, projectId, deletedAt: null },
    orderBy: { chapterNo: "asc" }
  });
}
