import type { PrismaClient } from "./generated/client";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// All existing-project outline writers take this lock before reading or mutating
// nodes. Model requests run outside it; finalization rechecks its source snapshot.
export async function lockOutlineProject(params: { tx: Tx; organizationId: string; projectId: string }) {
  const { tx, organizationId, projectId } = params;
  const rows = await tx.$queryRaw<Array<{ id: string; title: string; premise: string | null; genre: string | null; styleBrief: string | null }>>`
    SELECT id, title, premise, genre, style_brief AS "styleBrief" FROM projects
    WHERE id = ${projectId}::uuid AND organization_id = ${organizationId}::uuid AND deleted_at IS NULL FOR UPDATE
  `;
  if (!rows[0]) throw new Error("项目不存在或不属于当前组织");
  return rows[0];
}

export async function readOutlineSource(params: { tx: Tx; organizationId: string; projectId: string }) {
  return params.tx.outline.findMany({
    where: { organizationId: params.organizationId, projectId: params.projectId },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    select: { id: true, parentId: true, level: true, title: true, summary: true, orderIndex: true, status: true, targetChapterId: true, updatedAt: true }
  });
}
