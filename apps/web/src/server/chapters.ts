import { createHash } from "node:crypto";
import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";

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

interface ApplyDeslopEditParams {
  organizationId: string;
  chapterId: string;
  nextContent: string;
  baseContentHash?: string;
  updatedById: string;
  matchedText?: string;
  category?: string;
  prisma: PrismaClient;
}

const CONTENT_STALE_ERROR = "CHAPTER_CONTENT_STALE";
const VERSION_TITLE_MAX_LENGTH = 200;

export async function createVolume({ organizationId, projectId, title, orderIndex, summary, prisma }: CreateVolumeParams) {
  return prisma.volume.create({
    data: {
      organizationId, projectId, title, orderIndex,
      status: "PLANNED",
      ...(summary ? { summary } : {})
    }
  });
}

// 软删除章节：保留正文与版本链，避免误删后无法恢复。
export async function softDeleteChapter(
  organizationId: string,
  chapterId: string,
  prisma: PrismaClient
) {
  return prisma.chapter.update({
    where: { id: chapterId, organizationId },
    data: { deletedAt: new Date() }
  });
}

export async function findVolumesByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.volume.findMany({
    where: { organizationId, projectId },
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      title: true,
      summary: true,
      orderIndex: true,
      status: true,
      createdAt: true
    }
  });
}

interface UpdateVolumeInput {
  title?: string;
  summary?: string;
  status?: "PLANNED" | "DRAFTING" | "FINISHED";
}

export async function updateVolume(
  organizationId: string,
  volumeId: string,
  data: UpdateVolumeInput,
  prisma: PrismaClient
) {
  return prisma.volume.update({
    where: { id: volumeId, organizationId },
    data
  });
}

// 删除分卷只解除章节归属，不删章节本身——避免误删正文。
export async function deleteVolume(organizationId: string, volumeId: string, prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await tx.chapter.updateMany({
      where: { volumeId, organizationId },
      data: { volumeId: null }
    });
    return tx.volume.delete({ where: { id: volumeId, organizationId } });
  });
}

// 把章节移动到指定分卷（volumeId 传 null 表示移出分卷）。
export async function assignChapterVolume(
  organizationId: string,
  chapterId: string,
  volumeId: string | null,
  prisma: PrismaClient
) {
  return prisma.chapter.update({
    where: { id: chapterId, organizationId },
    data: { volumeId }
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

export async function applyDeslopEdit({
  organizationId,
  chapterId,
  nextContent,
  baseContentHash,
  updatedById,
  matchedText,
  category,
  prisma
}: ApplyDeslopEditParams) {
  return prisma.$transaction(async (tx) => {
    const chapter = await tx.chapter.findFirst({
      where: { id: chapterId, organizationId, deletedAt: null }
    });
    if (!chapter) throw new Error("章节不存在");

    if (baseContentHash && sha256Hex(chapter.content ?? "") !== baseContentHash) {
      throw new Error(CONTENT_STALE_ERROR);
    }

    const latest = await tx.contentVersion.findFirst({
      where: { entityType: "CHAPTER", entityId: chapterId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true, content: true }
    });
    let nextVersionNo = (latest?.versionNo ?? 0) + 1;

    if (chapter.content && chapter.content.trim().length > 0 && latest?.content !== chapter.content) {
      await tx.contentVersion.create({
        data: {
          organizationId,
          projectId: chapter.projectId,
          entityType: "CHAPTER",
          entityId: chapterId,
          versionNo: nextVersionNo,
          content: chapter.content,
          source: "MANUAL",
          title: "Before DESLOP apply",
          createdById: updatedById
        }
      });
      nextVersionNo += 1;
    }

    const updatedChapter = await tx.chapter.update({
      where: { id: chapterId },
      data: {
        content: nextContent,
        wordCount: computeWordCount(nextContent),
        updatedById
      }
    });

    const detail = [category, matchedText].filter(Boolean).join(" / ");
    const title = truncateVersionTitle(detail ? `DESLOP apply: ${detail}` : "DESLOP apply");
    const version = await tx.contentVersion.create({
      data: {
        organizationId,
        projectId: chapter.projectId,
        entityType: "CHAPTER",
        entityId: chapterId,
        versionNo: nextVersionNo,
        content: nextContent,
        source: "AI",
        title,
        createdById: updatedById
      },
      select: { id: true, versionNo: true }
    });

    return { chapter: updatedChapter, version };
  });
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function truncateVersionTitle(title: string): string {
  if (title.length <= VERSION_TITLE_MAX_LENGTH) return title;
  return `${title.slice(0, VERSION_TITLE_MAX_LENGTH - 3)}...`;
}

export async function findChaptersByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.chapter.findMany({
    where: { organizationId, projectId, deletedAt: null },
    orderBy: { chapterNo: "asc" }
  });
}
