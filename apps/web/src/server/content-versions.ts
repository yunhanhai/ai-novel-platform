import { lockMemorySourceChapter, supersedeChapterMemories } from "@ai-novel/db/chapter-memory";
import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { withVersionRetry } from "./version-retry";
import { createHash } from "node:crypto";

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
  chapterId: string;
  baseContentHash: string;
  versionId: string;
  updatedById: string;
  prisma: PrismaClient;
}

// 把指定版本写回章节正文，并把当前正文（如果有）保存为新的 MANUAL 版本，避免直接覆盖。
// 快照与正文更新放在同一事务内：否则快照写完、正文更新失败会留下孤儿版本，
// 让版本链出现无法解释的条目。版本号冲突由 withVersionRetry 重算重试。
export async function restoreChapterVersion({ organizationId, chapterId, baseContentHash, versionId, updatedById, prisma }: RestoreParams) {
  if (!/^[0-9a-f]{64}$/i.test(baseContentHash)) throw new Error("回滚需要有效的 baseContentHash");
  const version = await prisma.contentVersion.findFirst({
    where: { id: versionId, organizationId, entityType: "CHAPTER" }
  });
  if (!version || version.entityId !== chapterId) throw new Error("版本不存在或不属于当前章节");

  const chapter = await prisma.chapter.findFirst({
    where: { id: version.entityId, organizationId, deletedAt: null }
  });
  if (!chapter) throw new Error("章节不存在");

  return withVersionRetry(() =>
    prisma.$transaction(async (tx) => {
      const current = await lockMemorySourceChapter({ tx, organizationId, chapterId: chapter.id });
      const currentContent = current.content ?? "";
      // A lost response may be retried with the old base. Same-target reads must
      // not create snapshots, update timestamps or invalidate newer memories.
      if (currentContent === version.content) {
        return tx.chapter.findFirstOrThrow({ where: { id: chapterId, organizationId, deletedAt: null } });
      }
      if (createHash("sha256").update(currentContent).digest("hex") !== baseContentHash.toLowerCase()) {
        throw new Error("CHAPTER_CONTENT_STALE");
      }
      // 当前正文先快照成新版本（避免被覆盖丢失）
      if (current.content && current.content.trim().length > 0) {
        const latest = await tx.contentVersion.findFirst({
          where: { entityType: "CHAPTER", entityId: chapter.id },
          orderBy: { versionNo: "desc" },
          select: { versionNo: true, content: true }
        });
        if (!latest || latest.content !== current.content) {
          await tx.contentVersion.create({
            data: {
              organizationId,
              projectId: current.projectId,
              entityType: "CHAPTER",
              entityId: chapter.id,
              versionNo: (latest?.versionNo ?? 0) + 1,
              content: current.content,
              source: "MANUAL",
              createdById: updatedById
            }
          });
        }
      }

      const restored = await tx.chapter.update({
        where: { id: chapter.id },
        data: {
          content: version.content,
          wordCount: computeWordCount(version.content),
          updatedById
        }
      });
      if (current.content !== version.content) await supersedeChapterMemories({ tx, organizationId, projectId: current.projectId, chapterId: current.id });
      return restored;
    })
  );
}
