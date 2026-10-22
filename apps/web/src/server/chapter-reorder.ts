import type { PrismaClient } from "@ai-novel/db";

interface ReorderParams {
  organizationId: string;
  projectId: string;
  // 有序的章节 id 列表；服务端按此顺序重排 chapterNo（从 startAt 开始递增）
  orderedIds: string[];
  // 序号起始值，默认 1
  startAt?: number;
  prisma: PrismaClient;
}

/**
 * 按给定顺序重排章节的 chapterNo。
 *
 * 实现采用「两步腾挪」而不是直接赋目标值：
 *   第一步把涉及章节的 chapterNo 先搬到负数临时区间；
 *   第二步再按目标序号回写。
 * 这样避免重排过程中「中间状态撞唯一约束 (project_id, chapter_no)」——
 * 例如把第 3 章拖到第 1 位时，直接写 1 会先撞上现有第 1 章。
 * 负数区间不会与任何现有正序号冲突。
 *
 * 校验：orderedIds 里的章节必须都属于该项目且未删除（防止跨项目/已删章节混入）。
 */
export async function reorderChapters({
  organizationId,
  projectId,
  orderedIds,
  startAt = 1,
  prisma
}: ReorderParams): Promise<{ reordered: number }> {
  if (orderedIds.length === 0) return { reordered: 0 };

  const chapters = await prisma.chapter.findMany({
    where: {
      id: { in: orderedIds },
      organizationId,
      projectId,
      deletedAt: null
    },
    select: { id: true }
  });

  if (chapters.length !== orderedIds.length) {
    throw new Error("REORDER_CHAPTERS_MISMATCH");
  }

  return prisma.$transaction(async (tx) => {
    // 第一步：搬到负数临时区间（-index 保证互不相同）
    for (let i = 0; i < orderedIds.length; i += 1) {
      await tx.chapter.update({
        where: { id: orderedIds[i] },
        data: { chapterNo: -(i + 1) }
      });
    }

    // 第二步：按目标序号回写
    for (let i = 0; i < orderedIds.length; i += 1) {
      await tx.chapter.update({
        where: { id: orderedIds[i] },
        data: { chapterNo: startAt + i }
      });
    }

    return { reordered: orderedIds.length };
  });
}
