import type { PrismaClient } from "@ai-novel/db";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export interface BatchCheckpoint {
  mode: "BATCH_CONTINUE";
  checkpointVersion: 1;
  chapterId: string;
  requestedChapters: number;
  completedChapters: number;
  addedChars: number;
  memoryExtractedChapters: number;
  generationWarnings: Array<{ stepKey: string; code: string; message: string }>;
}
export class BatchCheckpointConflict extends Error {}
export function readBatchCheckpoint(value: unknown, chapterId: string, requested: number): BatchCheckpoint | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new BatchCheckpointConflict("批量进度记录无效，请核对已有版本后新建剩余任务");
  const row = value as Record<string, unknown>;
  if (row.mode !== "BATCH_CONTINUE" || row.checkpointVersion !== 1 || row.chapterId !== chapterId || row.requestedChapters !== requested ||
    !Number.isInteger(row.completedChapters) || Number(row.completedChapters) < 0 || Number(row.completedChapters) > requested ||
    !Number.isInteger(row.addedChars) || Number(row.addedChars) < 0 || !Number.isInteger(row.memoryExtractedChapters) || Number(row.memoryExtractedChapters) < 0 || Number(row.memoryExtractedChapters) > Number(row.completedChapters) ||
    !Array.isArray(row.generationWarnings) || row.generationWarnings.some(w => !w || typeof w !== "object" || typeof w.stepKey !== "string" || typeof w.code !== "string" || typeof w.message !== "string")) {
    throw new BatchCheckpointConflict("批量进度记录无效，请核对已有版本后新建剩余任务");
  }
  return {
    mode: "BATCH_CONTINUE", checkpointVersion: 1, chapterId, requestedChapters: requested,
    completedChapters: Number(row.completedChapters), addedChars: Number(row.addedChars),
    memoryExtractedChapters: Number(row.memoryExtractedChapters),
    generationWarnings: (row.generationWarnings as BatchCheckpoint["generationWarnings"]).map(w => ({ stepKey: w.stepKey, code: w.code, message: w.message }))
  };
}
export async function lockBatchJob(tx: Tx, job: { id: string; organizationId: string; projectId: string }) {
  const rows = await tx.$queryRaw<Array<{ status: string; output: unknown; attemptCount: number }>>`
    SELECT upper(status::text) AS status, output, attempt_count AS "attemptCount" FROM generation_jobs
    WHERE id = ${job.id}::uuid AND organization_id = ${job.organizationId}::uuid
      AND project_id = ${job.projectId}::uuid AND job_type = 'batch_continue' FOR UPDATE
  `;
  if (!rows[0]) throw new BatchCheckpointConflict("批量任务已不存在或不属于当前项目");
  return rows[0];
}
