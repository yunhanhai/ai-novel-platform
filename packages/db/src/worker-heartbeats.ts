import type { PrismaClient } from "./generated/client";

type JsonInput = Parameters<PrismaClient["workerHeartbeat"]["upsert"]>[0]["create"]["metadata"];

interface UpsertWorkerHeartbeatParams {
  organizationId: string;
  lockKey: string;
  pid?: number | null;
  startedAt: Date;
  lastSeenAt: Date;
  pollIntervalMs: number;
  leaseDurationMs: number;
  lastTickStatus?: string | null;
  lastTickAt?: Date | null;
  metadata?: JsonInput;
  prisma: PrismaClient;
}

interface ListWorkerHeartbeatsParams {
  organizationId: string;
  take?: number;
  prisma: PrismaClient;
}

export async function upsertWorkerHeartbeat(params: UpsertWorkerHeartbeatParams) {
  const {
    organizationId,
    lockKey,
    pid,
    startedAt,
    lastSeenAt,
    pollIntervalMs,
    leaseDurationMs,
    lastTickStatus,
    lastTickAt,
    metadata,
    prisma
  } = params;

  return prisma.workerHeartbeat.upsert({
    where: { lockKey },
    create: {
      organizationId,
      lockKey,
      pid,
      startedAt,
      lastSeenAt,
      pollIntervalMs,
      leaseDurationMs,
      lastTickStatus,
      lastTickAt,
      metadata
    },
    update: {
      organizationId,
      pid,
      lastSeenAt,
      pollIntervalMs,
      leaseDurationMs,
      lastTickStatus,
      lastTickAt,
      metadata
    }
  });
}

export async function listWorkerHeartbeats({ organizationId, take = 20, prisma }: ListWorkerHeartbeatsParams) {
  return prisma.workerHeartbeat.findMany({
    where: { organizationId },
    orderBy: { lastSeenAt: "desc" },
    take
  });
}
