import type { PrismaClient } from "./generated/client";
import { createHash } from "node:crypto";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type InputJson = Parameters<PrismaClient["generationJob"]["create"]>[0]["data"]["input"];

interface CreateJobParams {
  requestId?: string;
  organizationId: string;
  projectId: string;
  userId: string;
  jobType:
    | "GENERATE_OUTLINE"
    | "GENERATE_CHAPTER"
    | "CONTINUE_CHAPTER"
    | "BATCH_CONTINUE"
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
  organizationId?: string;
  lockKey: string;
  leaseDurationMs: number;
  prisma: PrismaClient;
}

interface UpdateStatusParams {
  expectedAttemptCount?: number;
  expectedStatus?: "RUNNING";
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

export async function createJob(params: CreateJobParams) {
  const { organizationId, projectId, userId, jobType, input, modelProfileId, targetEntityType, targetEntityId, prisma } = params;
  const data = {
    organizationId, projectId, userId, jobType, input,
    status: "QUEUED" as const, progress: "0",
    ...(modelProfileId ? { modelProfileId } : {}),
    ...(targetEntityType ? { targetEntityType } : {}),
    ...(targetEntityId ? { targetEntityId } : {})
  };
  if (!params.requestId) return prisma.generationJob.create({ data });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.requestId)) throw new Error("请求凭证格式无效");
  const digest = createHash("sha256").update(JSON.stringify(["generation-job-request-v1", organizationId, userId, params.requestId.toLowerCase()])).digest();
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  // ON CONFLICT DO NOTHING also remains usable inside an interactive transaction.
  await prisma.generationJob.createMany({ data: { ...data, id }, skipDuplicates: true });
  const existing = await prisma.generationJob.findFirst({ where: { id, organizationId, userId } });
  if (!existing) throw new Error("无法确认任务创建结果，请使用原请求凭证重试");
  if (existing.projectId !== projectId || existing.jobType !== jobType || existing.modelProfileId !== (modelProfileId ?? null) ||
    existing.targetEntityType !== (targetEntityType ?? null) || existing.targetEntityId !== (targetEntityId ?? null) ||
    canonicalJson(existing.input) !== canonicalJson(input)) throw new JobRequestConflict();
  return existing;
}

export class JobRequestConflict extends Error {
  constructor() { super("请求凭证已用于不同参数，请重新发起任务"); }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
}

export async function claimNextJob({ organizationId, lockKey, leaseDurationMs, prisma }: ClaimParams) {
  return prisma.$transaction(async (tx: Tx) => {
    const now = new Date();
    const job = await tx.generationJob.findFirst({
      where: {
        ...(organizationId ? { organizationId } : {}),
        OR: [
          {
            status: "QUEUED",
            nextRunAt: null,
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }]
          },
          {
            status: "QUEUED",
            nextRunAt: { lte: now },
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }]
          },
          {
            status: "RUNNING",
            leaseExpiresAt: { lt: now }
          }
        ]
      },
      orderBy: { createdAt: "asc" }
    });

    if (!job) return null;

    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

    try {
      return await tx.generationJob.update({
        where: { id: job.id, status: job.status, attemptCount: job.attemptCount,
          lockKey: job.lockKey, leaseExpiresAt: job.leaseExpiresAt, nextRunAt: job.nextRunAt },
        data: {
          status: "RUNNING",
          lockKey,
          leaseExpiresAt,
          startedAt: new Date(),
          attemptCount: { increment: 1 }
        }
      });
    } catch (error) {
      if (isMissingConditionalRow(error)) return null;
      throw error;
    }
  });
}

interface RequeueParams {
  jobId: string;
  attemptCount: number;
  nextRunAt: Date;
  errorMessage: string;
  prisma: PrismaClient;
}

export async function requeueJobForRetry({ jobId, attemptCount, nextRunAt, errorMessage, prisma }: RequeueParams) {
  try {
    return await prisma.generationJob.update({
      where: { id: jobId, status: "RUNNING", attemptCount },
      data: {
        status: "QUEUED",
        attemptCount,
        nextRunAt,
        lockKey: null,
        leaseExpiresAt: null,
        errorCode: "HANDLER_RETRY",
        errorMessage
      }
    });
  } catch (error) {
    if (!isMissingConditionalRow(error)) throw error;
    return prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  }
}

export async function releaseJobLease(jobId: string, lockKey: string, prisma: PrismaClient) {
  await prisma.generationJob.update({
    where: { id: jobId, lockKey },
    data: { lockKey: null, leaseExpiresAt: null }
  });
}

export async function updateJobStatus({ jobId, status, output, errorCode, errorMessage, expectedAttemptCount, expectedStatus, prisma }: UpdateStatusParams) {
  const now = new Date();
  const isSucceeded = status === "SUCCEEDED";

  try {
    return await prisma.generationJob.update({
      where: { id: jobId, ...(status !== "CANCELLED" ? { status: { not: "CANCELLED" as const } } : {}), ...(expectedStatus ? { status: expectedStatus } : {}), ...(expectedAttemptCount !== undefined ? { attemptCount: expectedAttemptCount } : {}) },
      data: {
        status,
        ...(isSucceeded ? { progress: "100", finishedAt: now, output: output ?? {} } : {}),
        ...(status === "FAILED" ? { finishedAt: now } : {}),
        ...(!isSucceeded && output ? { output } : {}),
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(errorMessage !== undefined ? { errorMessage } : {})
      }
    });
  } catch (error) {
    if (!isMissingConditionalRow(error)) throw error;
    return prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  }
}

function isMissingConditionalRow(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
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

type RecoveryDb = Pick<PrismaClient, "generationJob">;

export async function cancelGenerationJob(params: { organizationId: string; jobId: string; prisma: RecoveryDb }) {
  const { organizationId, jobId, prisma } = params;
  const cancelled = await prisma.generationJob.updateMany({
    where: { id: jobId, organizationId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", finishedAt: new Date(), errorCode: "CANCELLED_BY_USER", errorMessage: "已由用户停止" }
  });
  if (cancelled.count) return { ok: true as const, job: { id: jobId, status: "CANCELLED" as const } };
  const current = await prisma.generationJob.findFirst({ where: { id: jobId, organizationId }, select: { id: true, status: true } });
  if (!current) return { ok: false as const, reason: "not_found" as const };
  if (current.status === "CANCELLED") return { ok: true as const, job: { id: current.id, status: "CANCELLED" as const } };
  return { ok: false as const, reason: "invalid_status" as const };
}

export async function retryFailedJob(params: { organizationId: string; jobId: string; prisma: RecoveryDb }) {
  const existing = await params.prisma.generationJob.findFirst({
    where: { id: params.jobId, organizationId: params.organizationId },
    select: { id: true, status: true }
  });
  if (!existing) return { ok: false as const, reason: "not_found" as const };
  if (existing.status !== "FAILED") return { ok: false as const, reason: "invalid_status" as const, status: existing.status };
  const result = await params.prisma.generationJob.updateMany({
    where: { id: params.jobId, organizationId: params.organizationId, status: "FAILED" },
    data: { status: "QUEUED", progress: "0", attemptCount: 0, errorCode: null, errorMessage: null, lockKey: null,
      leaseExpiresAt: null, nextRunAt: null, startedAt: null, finishedAt: null }
  });
  if (!result.count) return { ok: false as const, reason: "invalid_status" as const };
  return { ok: true as const, job: { id: existing.id, status: "QUEUED" as const } };
}

export async function recoverExpiredJobLeases(params: { organizationId: string; now?: Date; limit?: number; prisma: RecoveryDb }) {
  const now = params.now ?? new Date();
  const expired = await params.prisma.generationJob.findMany({
    where: { organizationId: params.organizationId, status: "RUNNING", leaseExpiresAt: { lt: now } },
    orderBy: { leaseExpiresAt: "asc" }, take: Math.min(100, Math.max(1, Math.trunc(params.limit ?? 10)))
  });
  let recovered = 0;
  let failed = 0;
  for (const job of expired) {
    const exhausted = job.attemptCount >= job.maxAttempts;
    const result = await params.prisma.generationJob.updateMany({
      where: { id: job.id, organizationId: params.organizationId, status: "RUNNING", lockKey: job.lockKey,
        leaseExpiresAt: job.leaseExpiresAt, attemptCount: job.attemptCount },
      data: { status: exhausted ? "FAILED" : "QUEUED", lockKey: null, leaseExpiresAt: null,
        nextRunAt: exhausted ? null : now, startedAt: null, finishedAt: exhausted ? now : null,
        errorCode: "LEASE_EXPIRED", errorMessage: exhausted ? "任务租约过期且已达到重试上限" : "任务租约过期，已重新排队" }
    });
    if (result.count) { if (exhausted) failed++; else recovered++; }
  }
  return { recovered, failed };
}
