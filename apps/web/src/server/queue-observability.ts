import type { PrismaClient } from "@ai-novel/db";

export type QueueJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type QueueHealthState = "idle" | "active" | "backlog" | "attention";

export interface QueueObservabilityTotals {
  total: number;
  queued: number;
  running: number;
  retrying: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

export interface QueueJobSummary {
  id: string;
  jobType: string;
  status: QueueJobStatus;
  projectId: string;
  projectTitle: string;
  projectSlug: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRunAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface OldestQueuedJob extends QueueJobSummary {
  waitMs: number;
}

export interface OldestRetryingJob extends QueueJobSummary {
  retryInMs: number;
}

export interface QueueHealthSummary {
  state: QueueHealthState;
  label: string;
  detail: string;
}

export type WorkerHeartbeatStatus = "online" | "stale";

export interface WorkerHeartbeatSummary {
  id: string;
  lockKey: string;
  pid: number | null;
  status: WorkerHeartbeatStatus;
  heartbeatAgeMs: number;
  startedAt: string;
  lastSeenAt: string;
  pollIntervalMs: number;
  leaseDurationMs: number;
  lastTickStatus: string | null;
  lastTickAt: string | null;
}

export interface QueueWorkerSummary {
  total: number;
  online: number;
  stale: number;
  latestHeartbeatMs: number | null;
  items: WorkerHeartbeatSummary[];
}

export interface QueueObservability {
  organizationId: string;
  generatedAt: string;
  totals: QueueObservabilityTotals;
  health: QueueHealthSummary;
  workers: QueueWorkerSummary;
  oldestQueued: OldestQueuedJob | null;
  oldestRetrying: OldestRetryingJob | null;
  recentJobs: QueueJobSummary[];
}

interface GetQueueObservabilityParams {
  organizationId: string;
  prisma: PrismaClient;
  now?: Date;
}

const STATUSES: QueueJobStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"];
const WORKER_ONLINE_THRESHOLD_MS = 30_000;

export async function getQueueObservability(params: GetQueueObservabilityParams): Promise<QueueObservability> {
  const now = params.now ?? new Date();
  const retryingWhere = {
    organizationId: params.organizationId,
    status: "QUEUED" as const,
    nextRunAt: { gt: now }
  };
  const readyQueuedWhere = {
    organizationId: params.organizationId,
    status: "QUEUED" as const,
    OR: [
      { nextRunAt: null },
      { nextRunAt: { lte: now } }
    ]
  };

  const [groups, retryingCount, oldestQueuedRow, oldestRetryingRow, recentRows, workerRows] = await Promise.all([
    params.prisma.generationJob.groupBy({
      by: ["status"],
      where: { organizationId: params.organizationId },
      _count: { _all: true }
    }),
    params.prisma.generationJob.count({
      where: retryingWhere
    }),
    params.prisma.generationJob.findFirst({
      where: readyQueuedWhere,
      orderBy: { createdAt: "asc" },
      select: jobSelect()
    }),
    params.prisma.generationJob.findFirst({
      where: retryingWhere,
      orderBy: { nextRunAt: "asc" },
      select: jobSelect()
    }),
    params.prisma.generationJob.findMany({
      where: { organizationId: params.organizationId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: jobSelect()
    }),
    params.prisma.workerHeartbeat.findMany({
      where: { organizationId: params.organizationId },
      orderBy: { lastSeenAt: "desc" },
      take: 20
    })
  ]);

  const totals = buildTotals(groups, retryingCount);
  const oldestQueued = oldestQueuedRow ? { ...toJobSummary(oldestQueuedRow), waitMs: elapsedMs(oldestQueuedRow.createdAt, now) } : null;
  const oldestRetrying = oldestRetryingRow
    ? { ...toJobSummary(oldestRetryingRow), retryInMs: retryDelayMs(oldestRetryingRow.nextRunAt, now) }
    : null;
  const workers = buildWorkerSummary(workerRows, now);

  return {
    organizationId: params.organizationId,
    generatedAt: now.toISOString(),
    totals,
    health: buildHealth(totals, oldestQueued, oldestRetrying, workers),
    workers,
    oldestQueued,
    oldestRetrying,
    recentJobs: recentRows.map(toJobSummary)
  };
}

function jobSelect() {
  return {
    id: true,
    jobType: true,
    status: true,
    projectId: true,
    targetEntityType: true,
    targetEntityId: true,
    errorCode: true,
    errorMessage: true,
    attemptCount: true,
    maxAttempts: true,
    nextRunAt: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
    project: { select: { title: true, slug: true } }
  } as const;
}

function buildTotals(groups: Array<{ status: string; _count: { _all: number } }>, retryingCount: number): QueueObservabilityTotals {
  const counts = new Map(groups.map((group) => [group.status, group._count._all]));
  const queuedTotal = counts.get("QUEUED") ?? 0;
  const totals = {
    total: 0,
    queued: Math.max(0, queuedTotal - retryingCount),
    running: counts.get("RUNNING") ?? 0,
    retrying: retryingCount,
    succeeded: counts.get("SUCCEEDED") ?? 0,
    failed: counts.get("FAILED") ?? 0,
    cancelled: counts.get("CANCELLED") ?? 0
  };
  totals.total = STATUSES.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
  return totals;
}

function buildHealth(
  totals: QueueObservabilityTotals,
  oldestQueued: OldestQueuedJob | null,
  oldestRetrying: OldestRetryingJob | null,
  workers: QueueWorkerSummary
): QueueHealthSummary {
  if (totals.failed > 0) {
    return {
      state: "attention",
      label: "需要关注",
      detail: `${totals.failed} 个任务失败，优先查看最近失败记录`
    };
  }
  if (totals.queued > 0 && workers.online === 0) {
    return {
      state: "attention",
      label: "Worker 离线",
      detail: workers.total > 0
        ? "存在排队任务，但最近没有在线 Worker 心跳"
        : "存在排队任务，但尚未发现 Worker 心跳"
    };
  }
  if (oldestQueued && oldestQueued.waitMs >= 5 * 60_000 && totals.running === 0) {
    return {
      state: "attention",
      label: "可能阻塞",
      detail: `最老排队任务已等待 ${formatMinutes(oldestQueued.waitMs)}`
    };
  }
  if (totals.queued > 0) {
    return {
      state: "backlog",
      label: "有排队",
      detail: `${totals.queued} 个任务等待处理`
    };
  }
  if (totals.retrying > 0) {
    return {
      state: "backlog",
      label: "等待重试",
      detail: oldestRetrying
        ? `${totals.retrying} 个任务等待重试，最近一次将在 ${formatMinutes(oldestRetrying.retryInMs)} 后`
        : `${totals.retrying} 个任务等待重试`
    };
  }
  if (totals.running > 0) {
    return {
      state: "active",
      label: "处理中",
      detail: `${totals.running} 个任务正在运行`
    };
  }
  return {
    state: "idle",
    label: "空闲",
    detail: "当前没有等待或运行中的任务"
  };
}

function toJobSummary(row: ReturnType<typeof jobSelect> extends infer _T ? {
  id: string;
  jobType: string;
  status: string;
  projectId: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRunAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  project: { title: string; slug: string } | null;
} : never): QueueJobSummary {
  return {
    id: row.id,
    jobType: row.jobType,
    status: normalizeStatus(row.status),
    projectId: row.projectId,
    projectTitle: row.project?.title ?? "未关联项目",
    projectSlug: row.project?.slug ?? null,
    targetEntityType: row.targetEntityType,
    targetEntityId: row.targetEntityId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null
  };
}

function normalizeStatus(status: string): QueueJobStatus {
  return STATUSES.includes(status as QueueJobStatus) ? status as QueueJobStatus : "QUEUED";
}

interface WorkerHeartbeatRow {
  id: string;
  lockKey: string;
  pid: number | null;
  startedAt: Date;
  lastSeenAt: Date;
  pollIntervalMs: number;
  leaseDurationMs: number;
  lastTickStatus: string | null;
  lastTickAt: Date | null;
}

function buildWorkerSummary(rows: WorkerHeartbeatRow[], now: Date): QueueWorkerSummary {
  const items = rows.map((row) => {
    const heartbeatAgeMs = elapsedMs(row.lastSeenAt, now);
    const status: WorkerHeartbeatStatus = heartbeatAgeMs <= WORKER_ONLINE_THRESHOLD_MS ? "online" : "stale";
    return {
      id: row.id,
      lockKey: row.lockKey,
      pid: row.pid,
      status,
      heartbeatAgeMs,
      startedAt: row.startedAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      pollIntervalMs: row.pollIntervalMs,
      leaseDurationMs: row.leaseDurationMs,
      lastTickStatus: row.lastTickStatus,
      lastTickAt: row.lastTickAt?.toISOString() ?? null
    };
  });
  const online = items.filter((item) => item.status === "online").length;

  return {
    total: items.length,
    online,
    stale: items.length - online,
    latestHeartbeatMs: items[0]?.heartbeatAgeMs ?? null,
    items
  };
}

function elapsedMs(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime());
}

function retryDelayMs(nextRunAt: Date | null, now: Date): number {
  return nextRunAt ? Math.max(0, nextRunAt.getTime() - now.getTime()) : 0;
}

function formatMinutes(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} 分钟`;
}
