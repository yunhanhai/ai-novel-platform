import type { PrismaClient } from "@ai-novel/db";

export type QueueJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type QueueHealthState = "idle" | "active" | "backlog" | "attention";

export interface QueueObservabilityTotals {
  total: number;
  queued: number;
  running: number;
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
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface OldestQueuedJob extends QueueJobSummary {
  waitMs: number;
}

export interface QueueHealthSummary {
  state: QueueHealthState;
  label: string;
  detail: string;
}

export interface QueueObservability {
  organizationId: string;
  generatedAt: string;
  totals: QueueObservabilityTotals;
  health: QueueHealthSummary;
  oldestQueued: OldestQueuedJob | null;
  recentJobs: QueueJobSummary[];
}

interface GetQueueObservabilityParams {
  organizationId: string;
  prisma: PrismaClient;
  now?: Date;
}

const STATUSES: QueueJobStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"];

export async function getQueueObservability(params: GetQueueObservabilityParams): Promise<QueueObservability> {
  const now = params.now ?? new Date();
  const [groups, oldestQueuedRow, recentRows] = await Promise.all([
    params.prisma.generationJob.groupBy({
      by: ["status"],
      where: { organizationId: params.organizationId },
      _count: { _all: true }
    }),
    params.prisma.generationJob.findFirst({
      where: { organizationId: params.organizationId, status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      select: jobSelect()
    }),
    params.prisma.generationJob.findMany({
      where: { organizationId: params.organizationId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: jobSelect()
    })
  ]);

  const totals = buildTotals(groups);
  const oldestQueued = oldestQueuedRow ? { ...toJobSummary(oldestQueuedRow), waitMs: elapsedMs(oldestQueuedRow.createdAt, now) } : null;

  return {
    organizationId: params.organizationId,
    generatedAt: now.toISOString(),
    totals,
    health: buildHealth(totals, oldestQueued),
    oldestQueued,
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
    createdAt: true,
    startedAt: true,
    finishedAt: true,
    project: { select: { title: true, slug: true } }
  } as const;
}

function buildTotals(groups: Array<{ status: string; _count: { _all: number } }>): QueueObservabilityTotals {
  const counts = new Map(groups.map((group) => [group.status, group._count._all]));
  const totals = {
    total: 0,
    queued: counts.get("QUEUED") ?? 0,
    running: counts.get("RUNNING") ?? 0,
    succeeded: counts.get("SUCCEEDED") ?? 0,
    failed: counts.get("FAILED") ?? 0,
    cancelled: counts.get("CANCELLED") ?? 0
  };
  totals.total = STATUSES.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
  return totals;
}

function buildHealth(totals: QueueObservabilityTotals, oldestQueued: OldestQueuedJob | null): QueueHealthSummary {
  if (totals.failed > 0) {
    return {
      state: "attention",
      label: "需要关注",
      detail: `${totals.failed} 个任务失败，优先查看最近失败记录`
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
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null
  };
}

function normalizeStatus(status: string): QueueJobStatus {
  return STATUSES.includes(status as QueueJobStatus) ? status as QueueJobStatus : "QUEUED";
}

function elapsedMs(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime());
}

function formatMinutes(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} 分钟`;
}
