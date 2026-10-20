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
  organizationId?: string;
  lockKey: string;
  leaseDurationMs: number;
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

export async function createJob(params: CreateJobParams) {
  const { organizationId, projectId, userId, jobType, input, modelProfileId, targetEntityType, targetEntityId, prisma } = params;

  return prisma.generationJob.create({
    data: {
      organizationId, projectId, userId, jobType, input,
      status: "QUEUED", progress: "0",
      ...(modelProfileId ? { modelProfileId } : {}),
      ...(targetEntityType ? { targetEntityType } : {}),
      ...(targetEntityId ? { targetEntityId } : {})
    }
  });
}

export async function claimNextJob({ organizationId, lockKey, leaseDurationMs, prisma }: ClaimParams) {
  return prisma.$transaction(async (tx: Tx) => {
    const job = await tx.generationJob.findFirst({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: "QUEUED",
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: new Date() } }
        ]
      },
      orderBy: { createdAt: "asc" }
    });

    if (!job) return null;

    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

    return tx.generationJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", lockKey, leaseExpiresAt, startedAt: new Date() }
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
