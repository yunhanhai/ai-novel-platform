import type { PrismaClient } from "./generated/client";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type InputJson = Parameters<PrismaClient["generationJob"]["create"]>[0]["data"]["input"];

interface CreateJobParams {
  organizationId: string;
  projectId: string;
  userId: string;
  jobType:
    | "GENERATE_OUTLINE"
    | "GENERATE_CHAPTER"
    | "CONTINUE_CHAPTER"
    | "REWRITE"
    | "POLISH"
    | "DESLOP"
    | "REVIEW"
    | "EXTRACT_MEMORY"
    | "DIAGNOSE_CHAPTER"
    | "READER_SIMULATION"
    | "STYLE_DRIFT_CHECK"
    | "CONTINUITY_CHECK";
  input: InputJson;
  modelProfileId?: string;
  targetEntityType?: "PROJECT" | "OUTLINE" | "CHAPTER";
  targetEntityId?: string;
  prisma: PrismaClient;
}

interface ClaimParams {
  organizationId: string;
  lockKey: string;
  leaseDurationMs: number;
  now?: Date;
  prisma: PrismaClient;
}

interface UpdateStatusParams {
  jobId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output?: InputJson;
  errorCode?: string | null;
  errorMessage?: string | null;
  prisma: PrismaClient;
}

interface CreateStepParams {
  organizationId: string;
  jobId: string;
  stepKey: string;
  modelProfileId?: string;
  prisma: PrismaClient;
}

interface UpdateStepParams {
  stepId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  outputPreview?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  errorMessage?: string;
  prisma: PrismaClient;
}

interface ScheduleJobRetryParams {
  jobId: string;
  attemptCount: number;
  errorCode: string;
  errorMessage: string;
  now?: Date;
  prisma: PrismaClient;
}

interface MarkJobFailedParams {
  jobId: string;
  errorCode: string;
  errorMessage: string;
  now?: Date;
  prisma: PrismaClient;
}

interface RecoverExpiredJobLeasesParams {
  organizationId: string;
  now?: Date;
  limit?: number;
  prisma: PrismaClient;
}

interface RetryFailedJobParams {
  organizationId: string;
  jobId: string;
  prisma: PrismaClient;
}

export type RetryFailedJobResult =
  | { ok: true; job: Awaited<ReturnType<PrismaClient["generationJob"]["update"]>> }
  | { ok: false; reason: "not_found" | "invalid_status"; status?: string };

interface RecoverableJob {
  id: string;
  attemptCount: number;
  maxAttempts: number;
}

export async function createJob(params: CreateJobParams) {
  const { organizationId, projectId, userId, jobType, input, modelProfileId, targetEntityType, targetEntityId, prisma } = params;

  return prisma.generationJob.create({
    data: {
      organizationId, projectId, userId, jobType, input,
      status: "QUEUED", progress: "0",
      attemptCount: 0,
      maxAttempts: 3,
      nextRunAt: null,
      ...(modelProfileId ? { modelProfileId } : {}),
      ...(targetEntityType ? { targetEntityType } : {}),
      ...(targetEntityId ? { targetEntityId } : {})
    }
  });
}

export async function claimNextJob({ organizationId, lockKey, leaseDurationMs, now = new Date(), prisma }: ClaimParams) {
  return prisma.$transaction(async (tx: Tx) => {
    const job = await tx.generationJob.findFirst({
      where: {
        organizationId,
        status: "QUEUED",
        OR: [
          { nextRunAt: null },
          { nextRunAt: { lte: now } }
        ]
      },
      orderBy: { createdAt: "asc" }
    });

    if (!job) return null;

    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    return tx.generationJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", lockKey, leaseExpiresAt, startedAt: now }
    });
  });
}

export async function releaseJobLease(jobId: string, lockKey: string, prisma: PrismaClient) {
  await prisma.generationJob.update({
    where: { id: jobId, lockKey },
    data: { lockKey: null, leaseExpiresAt: null }
  });
}

export async function updateJobStatus({ jobId, status, output, errorCode, errorMessage, prisma }: UpdateStatusParams) {
  const now = new Date();
  const isSucceeded = status === "SUCCEEDED";

  return prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status,
      ...(isSucceeded ? { progress: "100", finishedAt: now, output: output ?? {} } : {}),
      ...(status === "FAILED" ? { finishedAt: now } : {}),
      ...(!isSucceeded && output ? { output } : {}),
      ...(errorCode !== undefined ? { errorCode } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {})
    }
  });
}

export function computeRetryDelayMs(attemptNumber: number): number {
  if (attemptNumber <= 1) return 10_000;
  if (attemptNumber === 2) return 30_000;
  return 120_000;
}

export async function scheduleJobRetry({
  jobId,
  attemptCount,
  errorCode,
  errorMessage,
  now = new Date(),
  prisma
}: ScheduleJobRetryParams) {
  const nextAttempt = attemptCount + 1;
  const nextRunAt = new Date(now.getTime() + computeRetryDelayMs(nextAttempt));

  return prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      attemptCount: { increment: 1 },
      nextRunAt,
      lockKey: null,
      leaseExpiresAt: null,
      startedAt: null,
      errorCode,
      errorMessage
    }
  });
}

export async function markJobFailed({
  jobId,
  errorCode,
  errorMessage,
  now = new Date(),
  prisma
}: MarkJobFailedParams) {
  return prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt: now,
      lockKey: null,
      leaseExpiresAt: null,
      nextRunAt: null,
      errorCode,
      errorMessage
    }
  });
}

export async function retryFailedJob({
  organizationId,
  jobId,
  prisma
}: RetryFailedJobParams): Promise<RetryFailedJobResult> {
  const existing = await prisma.generationJob.findFirst({
    where: { id: jobId, organizationId },
    select: { id: true, status: true }
  });

  if (!existing) {
    return { ok: false, reason: "not_found" };
  }

  if (existing.status !== "FAILED") {
    return { ok: false, reason: "invalid_status", status: existing.status };
  }

  const job = await prisma.generationJob.update({
    where: { id: existing.id },
    data: {
      status: "QUEUED",
      progress: "0",
      errorCode: null,
      errorMessage: null,
      lockKey: null,
      leaseExpiresAt: null,
      nextRunAt: null,
      startedAt: null,
      finishedAt: null
    }
  });

  return { ok: true, job };
}

export async function recoverExpiredJobLeases({
  organizationId,
  now = new Date(),
  limit = 10,
  prisma
}: RecoverExpiredJobLeasesParams): Promise<{ recovered: number; failed: number }> {
  const expired = await prisma.generationJob.findMany({
    where: {
      organizationId,
      status: "RUNNING",
      leaseExpiresAt: { lt: now }
    },
    orderBy: { leaseExpiresAt: "asc" },
    take: limit
  });

  let recovered = 0;
  let failed = 0;

  for (const job of expired as RecoverableJob[]) {
    const nextAttempt = job.attemptCount + 1;
    if (nextAttempt >= job.maxAttempts) {
      await markJobFailed({
        jobId: job.id,
        errorCode: "LEASE_EXPIRED",
        errorMessage: "Worker lease expired and retry attempts are exhausted",
        now,
        prisma
      });
      failed += 1;
    } else {
      await scheduleJobRetry({
        jobId: job.id,
        attemptCount: job.attemptCount,
        errorCode: "LEASE_EXPIRED",
        errorMessage: "Worker lease expired before the job completed",
        now,
        prisma
      });
      recovered += 1;
    }
  }

  return { recovered, failed };
}

export async function createStep({ organizationId, jobId, stepKey, modelProfileId, prisma }: CreateStepParams) {
  return prisma.generationStep.create({
    data: {
      organizationId, jobId, stepKey, status: "PENDING",
      startedAt: new Date(),
      ...(modelProfileId ? { modelProfileId } : {})
    }
  });
}

export async function updateStep({ stepId, status, outputPreview, inputTokens, outputTokens, latencyMs, errorMessage, prisma }: UpdateStepParams) {
  const isFinal = status === "SUCCEEDED" || status === "FAILED";

  return prisma.generationStep.update({
    where: { id: stepId },
    data: {
      status,
      ...(isFinal ? { finishedAt: new Date() } : {}),
      ...(outputPreview !== undefined ? { outputPreview } : {}),
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {})
    }
  });
}
