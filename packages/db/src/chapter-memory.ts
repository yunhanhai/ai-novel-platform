import type { PrismaClient } from "./generated/client";
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function lockMemorySourceChapter(params: { tx: Tx; organizationId: string; chapterId: string; projectId?: string }) {
  const { tx, organizationId, chapterId, projectId } = params;
  const rows = await tx.$queryRaw<Array<{ id: string; projectId: string; content: string | null }>>`
    SELECT id, project_id AS "projectId", content FROM chapters
    WHERE id = ${chapterId}::uuid AND organization_id = ${organizationId}::uuid AND deleted_at IS NULL
      AND (${projectId ?? null}::uuid IS NULL OR project_id = ${projectId ?? null}::uuid)
    FOR UPDATE
  `;
  if (!rows[0]) throw new Error("章节不存在或不属于当前项目");
  return rows[0];
}

export async function supersedeChapterMemories(params: { tx: Tx; organizationId: string; projectId: string; chapterId: string }) {
  const { tx, organizationId, projectId, chapterId } = params;
  return tx.projectMemory.updateMany({
    where: { organizationId, projectId, sourceChapterId: chapterId, status: { in: ["proposed", "accepted"] } },
    data: { status: "superseded" }
  });
}

export function activeMemorySourceFilter(organizationId: string, projectId: string, beforeChapterNo?: number) {
  return {
    OR: [
      { sourceChapterId: null },
      { sourceChapter: { is: {
        organizationId, projectId, deletedAt: null,
        ...(beforeChapterNo !== undefined ? { chapterNo: { lt: beforeChapterNo } } : {})
      } } }
    ]
  };
}
