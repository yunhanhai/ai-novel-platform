import { labelForGenerationJobStatus } from "../../lib/display-labels";
import type {
  QueueJobSummary,
  QueueHealthState,
  QueueObservability,
  QueueObservabilityTotals,
  WorkerHeartbeatStatus
} from "../../server/queue-observability";

export interface QueueStatusDisplayItem {
  key: keyof Omit<QueueObservabilityTotals, "total">;
  label: string;
  value: number;
  tone: string;
  width: string;
}

export type QueueActionKind = "recover-expired-leases" | "retry-failed-job";

const STATUS_CONFIG: Array<{ key: QueueStatusDisplayItem["key"]; label: string; tone: string }> = [
  { key: "queued", label: "排队", tone: "queued" },
  { key: "retrying", label: "等待重试", tone: "retrying" },
  { key: "running", label: "运行", tone: "running" },
  { key: "failed", label: "失败", tone: "failed" },
  { key: "succeeded", label: "成功", tone: "succeeded" },
  { key: "cancelled", label: "取消", tone: "cancelled" }
];

export function getStatusItems(data: QueueObservability): QueueStatusDisplayItem[] {
  const max = Math.max(...STATUS_CONFIG.map((item) => data.totals[item.key]), 1);
  return STATUS_CONFIG.map((item) => {
    const value = data.totals[item.key];
    return {
      ...item,
      value,
      width: value === 0 ? "0%" : `${Math.max(8, Math.round((value / max) * 100))}%`
    };
  });
}

export function formatQueueWait(waitMs: number | null | undefined): string {
  if (waitMs === null || waitMs === undefined) return "无排队";
  return formatDuration(waitMs);
}

export function formatRetryWait(waitMs: number | null | undefined): string {
  if (waitMs === null || waitMs === undefined) return "无重试";
  return formatDuration(waitMs);
}

function formatDuration(waitMs: number): string {
  if (waitMs < 60_000) return "<1 分钟";
  const totalMinutes = Math.max(1, Math.round(waitMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

export function formatHeartbeatAge(ageMs: number | null | undefined): string {
  if (ageMs === null || ageMs === undefined) return "无心跳";
  if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1000))} 秒前`;
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.max(1, Math.round(minutes / 60))} 小时前`;
}

export function getWorkerStatusDisplay(status: WorkerHeartbeatStatus): { label: string; tone: string } {
  if (status === "online") {
    return { label: "在线", tone: "online" };
  }
  return { label: "过期", tone: "stale" };
}

export function getJobStatusDisplay(job: QueueJobSummary): { label: string; tone: string } {
  if (job.status === "QUEUED" && job.nextRunAt) {
    return { label: "等待重试", tone: "retrying" };
  }
  return { label: labelForGenerationJobStatus(job.status), tone: job.status.toLowerCase() };
}

export function formatJobAttempt(job: Pick<QueueJobSummary, "attemptCount" | "maxAttempts">): string {
  if (job.attemptCount <= 0) return "首次";
  return `尝试 ${job.attemptCount}/${job.maxAttempts}`;
}

export function canRetryJob(job: Pick<QueueJobSummary, "status">): boolean {
  return job.status === "FAILED";
}

export function getQueueActionCopy(action: QueueActionKind): { label: string; busyLabel: string } {
  if (action === "recover-expired-leases") {
    return { label: "回收过期租约", busyLabel: "回收中" };
  }
  return { label: "重试", busyLabel: "重试中" };
}

export function getHealthToneClass(state: QueueHealthState): string {
  return `queue-health-${state}`;
}

export function isQueueEmpty(data: QueueObservability | null): boolean {
  return data !== null && data.totals.total === 0;
}
