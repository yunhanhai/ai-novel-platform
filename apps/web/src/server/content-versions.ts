import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { withVersionRetry } from "./version-retry";

interface ListVersionsParams {
  organizationId: string;
  chapterId: string;
  prisma: PrismaClient;
  limit?: number;
}

export async function listChapterVersions({ organizationId, chapterId, prisma, limit = 50 }: ListVersionsParams) {
  return prisma.contentVersion.findMany({
    where: { organizationId, entityType: "CHAPTER", entityId: chapterId },
    orderBy: { versionNo: "desc" },
    take: limit,
    select: {
      id: true,
      versionNo: true,
      source: true,
      generationJobId: true,
      createdById: true,
      createdAt: true,
      content: true,
      title: true
    }
  });
}

export async function getChapterVersion(organizationId: string, versionId: string, prisma: PrismaClient) {
  return prisma.contentVersion.findFirst({
    where: { id: versionId, organizationId, entityType: "CHAPTER" }
  });
}

interface RestoreParams {
  organizationId: string;
  versionId: string;
  updatedById: string;
  prisma: PrismaClient;
}

// 把指定版本写回章节正文，并把当前正文（如果有）保存为新的 MANUAL 版本，避免直接覆盖。
// 快照与正文更新放在同一事务内：否则快照写完、正文更新失败会留下孤儿版本，
// 让版本链出现无法解释的条目。版本号冲突由 withVersionRetry 重算重试。
export async function restoreChapterVersion({ organizationId, versionId, updatedById, prisma }: RestoreParams) {
  const version = await prisma.contentVersion.findFirst({
    where: { id: versionId, organizationId, entityType: "CHAPTER" }
  });
  if (!version) throw new Error("版本不存在");

  const chapter = await prisma.chapter.findFirst({
    where: { id: version.entityId, organizationId, deletedAt: null }
  });
  if (!chapter) throw new Error("章节不存在");

  return withVersionRetry(() =>
    prisma.$transaction(async (tx) => {
      // 当前正文先快照成新版本（避免被覆盖丢失）
      if (chapter.content && chapter.content.trim().length > 0) {
        const latest = await tx.contentVersion.findFirst({
          where: { entityType: "CHAPTER", entityId: chapter.id },
          orderBy: { versionNo: "desc" },
          select: { versionNo: true, content: true }
        });
        if (!latest || latest.content !== chapter.content) {
          await tx.contentVersion.create({
            data: {
              organizationId,
              projectId: chapter.projectId,
              entityType: "CHAPTER",
              entityId: chapter.id,
              versionNo: (latest?.versionNo ?? 0) + 1,
              content: chapter.content,
              source: "MANUAL",
              createdById: updatedById
            }
          });
        }
      }

      return tx.chapter.update({
        where: { id: chapter.id },
        data: {
          content: version.content,
          wordCount: computeWordCount(version.content),
          updatedById
        }
      });
    })
  );
}
