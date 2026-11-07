import type { PrismaClient, Prisma } from "@ai-novel/db";
import { lockMemorySourceChapter } from "@ai-novel/db/chapter-memory";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import type { GenerationJob } from "../poll";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export class ContinuationAttemptChanged extends Error {
  constructor() { super("续写任务已由其他执行接手或已结束，未覆盖正文"); }
}
export class ChapterSourceChanged extends Error {
  constructor() { super("续写期间正文已变化，已保留最新正文；请核对后重新发起续写"); }
}
export async function lockContinuationJob(tx: Tx, job: GenerationJob) {
  const rows = await tx.$queryRaw<Array<{ status: string; attemptCount: number; output: unknown }>>`
    SELECT upper(status::text) AS status, attempt_count AS "attemptCount", output FROM generation_jobs
    WHERE id = ${job.id}::uuid AND organization_id = ${job.organizationId}::uuid
      AND project_id = ${job.projectId}::uuid AND job_type = 'continue_chapter' FOR UPDATE
  `;
  const row = rows[0];
  if (!row || row.attemptCount !== (job.attemptCount ?? 1) || !["RUNNING", "CANCELLED", "SUCCEEDED"].includes(row.status)) {
    throw new ContinuationAttemptChanged();
  }
  return row;
}
export function continuationVersionWhere(job: GenerationJob, chapterId: string) {
  return { organizationId: job.organizationId, projectId: job.projectId, entityType: "CHAPTER" as const,
    entityId: chapterId, generationJobId: job.id, source: "AI" as const };
}

/** A committed version is the receipt. Recovery only repairs job metadata, never prose. */
export async function recoverSavedContinuation(prisma: PrismaClient, job: GenerationJob, chapterId: string): Promise<boolean> {
  const where = continuationVersionWhere(job, chapterId);
  const saved = await prisma.contentVersion.findFirst({ where, orderBy: { versionNo: "desc" } });
  if (!saved) return false;
  await prisma.$transaction(async tx => {
    // Use the same chapter -> job lock order as finalize.
    await lockMemorySourceChapter({ tx, organizationId: job.organizationId, projectId: job.projectId, chapterId });
    const locked = await lockContinuationJob(tx, job);
    if (locked.status === "SUCCEEDED") return;
    const receipt = await tx.contentVersion.findFirst({ where, orderBy: { versionNo: "desc" } });
    if (!receipt) throw new ContinuationAttemptChanged();
    const prior = locked.output && typeof locked.output === "object" && !Array.isArray(locked.output)
      ? locked.output as Record<string, unknown> : {};
    const metadata = prior.versionId === receipt.id && prior.chapterId === chapterId ? prior : {};
    const output = { ...metadata, chapterId, versionId: receipt.id, versionNo: receipt.versionNo,
      wordCount: computeWordCount(receipt.content), mode: "CONTINUE_CHAPTER" };
    await tx.generationJob.update({ where: { id: job.id }, data: {
      ...(locked.status === "CANCELLED" ? {} : { status: "SUCCEEDED", progress: "100", finishedAt: new Date(), errorCode: null, errorMessage: null }),
      output: output as unknown as Prisma.InputJsonValue
    } });
  });
  return true;
}
