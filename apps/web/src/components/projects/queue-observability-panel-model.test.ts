import { describe, expect, it } from "vitest";
import {
  canRetryJob,
  formatHeartbeatAge,
  formatJobAttempt,
  formatQueueWait,
  formatRetryWait,
  getQueueActionCopy,
  getJobStatusDisplay,
  getHealthToneClass,
  getStatusItems,
  getWorkerStatusDisplay,
  isQueueEmpty
} from "./queue-observability-panel-model";
import type { QueueJobSummary, QueueObservability } from "../../server/queue-observability";

function data(overrides: Partial<QueueObservability["totals"]> = {}): QueueObservability {
  return {
    organizationId: "org-1",
    generatedAt: "2026-05-28T10:00:00.000Z",
    totals: {
      total: 0,
      queued: 0,
      running: 0,
      retrying: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      ...overrides
    },
    health: { state: "idle", label: "空闲", detail: "" },
    workers: {
      total: 0,
      online: 0,
      stale: 0,
      latestHeartbeatMs: null,
      items: []
    },
    oldestQueued: null,
    oldestRetrying: null,
    recentJobs: []
  };
}

function job(overrides: Partial<QueueJobSummary> = {}): QueueJobSummary {
  return {
    id: "job-1",
    jobType: "GENERATE_CHAPTER",
    status: "QUEUED",
    projectId: "project-1",
    projectTitle: "Project One",
    projectSlug: "project-one",
    targetEntityType: "CHAPTER",
    targetEntityId: "chapter-1",
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    maxAttempts: 3,
    nextRunAt: null,
    createdAt: "2026-05-28T09:58:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides
  };
}

describe("queue observability panel model", () => {
  it("maps status counts in operational priority order", () => {
    const items = getStatusItems(data({ total: 11, queued: 3, retrying: 2, running: 1, failed: 2, succeeded: 3 }));

    expect(items.map((item) => item.key)).toEqual(["queued", "retrying", "running", "failed", "succeeded", "cancelled"]);
    expect(items[0]).toMatchObject({ label: "排队", value: 3, tone: "queued", width: "100%" });
    expect(items[1]).toMatchObject({ label: "等待重试", value: 2, tone: "retrying", width: "67%" });
    expect(items[2]).toMatchObject({ label: "运行", value: 1, tone: "running", width: "33%" });
    expect(items[5]).toMatchObject({ label: "取消", value: 0, tone: "cancelled", width: "0%" });
  });

  it("formats queued wait duration for compact display", () => {
    expect(formatQueueWait(null)).toBe("无排队");
    expect(formatQueueWait(30_000)).toBe("<1 分钟");
    expect(formatQueueWait(5 * 60_000)).toBe("5 分钟");
    expect(formatQueueWait(95 * 60_000)).toBe("1 小时 35 分钟");
  });

  it("maps health state to stable CSS tone classes", () => {
    expect(getHealthToneClass("idle")).toBe("queue-health-idle");
    expect(getHealthToneClass("active")).toBe("queue-health-active");
    expect(getHealthToneClass("backlog")).toBe("queue-health-backlog");
    expect(getHealthToneClass("attention")).toBe("queue-health-attention");
  });

  it("detects empty queue data only after data has loaded", () => {
    expect(isQueueEmpty(null)).toBe(false);
    expect(isQueueEmpty(data())).toBe(true);
    expect(isQueueEmpty(data({ total: 1, running: 1 }))).toBe(false);
  });

  it("formats worker heartbeat age for compact display", () => {
    expect(formatHeartbeatAge(null)).toBe("无心跳");
    expect(formatHeartbeatAge(5_000)).toBe("5 秒前");
    expect(formatHeartbeatAge(95_000)).toBe("2 分钟前");
    expect(formatHeartbeatAge(2 * 60 * 60_000)).toBe("2 小时前");
  });

  it("formats retry wait duration for compact display", () => {
    expect(formatRetryWait(null)).toBe("无重试");
    expect(formatRetryWait(30_000)).toBe("<1 分钟");
    expect(formatRetryWait(5 * 60_000)).toBe("5 分钟");
    expect(formatRetryWait(95 * 60_000)).toBe("1 小时 35 分钟");
  });

  it("labels retrying jobs and attempt counts for recent rows", () => {
    expect(getJobStatusDisplay(job({ status: "QUEUED", nextRunAt: "2026-05-28T10:02:00.000Z" }))).toEqual({
      label: "等待重试",
      tone: "retrying"
    });
    expect(getJobStatusDisplay(job({ status: "RUNNING" }))).toEqual({ label: "运行中", tone: "running" });
    expect(formatJobAttempt(job({ attemptCount: 0, maxAttempts: 3 }))).toBe("首次");
    expect(formatJobAttempt(job({ attemptCount: 2, maxAttempts: 3 }))).toBe("尝试 2/3");
  });

  it("allows manual retry only for failed recent jobs", () => {
    expect(canRetryJob(job({ status: "FAILED" }))).toBe(true);
    expect(canRetryJob(job({ status: "QUEUED" }))).toBe(false);
    expect(canRetryJob(job({ status: "RUNNING" }))).toBe(false);
    expect(canRetryJob(job({ status: "SUCCEEDED" }))).toBe(false);
  });

  it("returns stable copy for queue recovery actions", () => {
    expect(getQueueActionCopy("recover-expired-leases")).toEqual({
      label: "回收过期租约",
      busyLabel: "回收中"
    });
    expect(getQueueActionCopy("retry-failed-job")).toEqual({
      label: "重试",
      busyLabel: "重试中"
    });
  });

  it("maps worker heartbeat status to readable labels and tones", () => {
    expect(getWorkerStatusDisplay("online")).toEqual({ label: "在线", tone: "online" });
    expect(getWorkerStatusDisplay("stale")).toEqual({ label: "过期", tone: "stale" });
  });
});
