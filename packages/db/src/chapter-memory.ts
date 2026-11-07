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

const GENERATION_MEMORY_LIMIT = 20;
const RECENT_SUMMARY_LIMIT = 5;

export async function findGenerationMemories(params: {
  prisma: Pick<PrismaClient, "projectMemory">;
  organizationId: string;
  projectId: string;
  beforeChapterNo: number;
}) {
  const { prisma, organizationId, projectId, beforeChapterNo } = params;
  const recent = await prisma.projectMemory.findMany({
    where: {
      organizationId, projectId, status: "accepted", memoryType: "chapter_summary",
      sourceChapterId: { not: null },
      sourceChapter: { is: { organizationId, projectId, deletedAt: null, chapterNo: { lt: beforeChapterNo } } }
    },
    orderBy: [{ sourceChapter: { chapterNo: "desc" } }, { createdAt: "desc" }, { id: "desc" }],
    distinct: ["sourceChapterId"],
    take: RECENT_SUMMARY_LIMIT
  });
  const sourceIds = recent.flatMap(memory => memory.sourceChapterId ? [memory.sourceChapterId] : []);
  const remaining = await prisma.projectMemory.findMany({
    where: {
      organizationId, projectId, status: "accepted",
      ...activeMemorySourceFilter(organizationId, projectId, beforeChapterNo),
      id: { notIn: recent.map(memory => memory.id) },
      // Legacy duplicate summaries from a reserved chapter must not consume the rest.
      ...(sourceIds.length ? { AND: [{ OR: [
        { sourceChapterId: null },
        { memoryType: { not: "chapter_summary" } },
        { sourceChapterId: { notIn: sourceIds } }
      ] }] } : {})
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: GENERATION_MEMORY_LIMIT - recent.length
  });
  return [...new Map([...recent, ...remaining].map(memory => [memory.id, memory])).values()].slice(0, GENERATION_MEMORY_LIMIT);
}
