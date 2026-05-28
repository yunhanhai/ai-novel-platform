import { describe, expect, it } from "vitest";
import {
  formatHeartbeatAge,
  formatQueueWait,
  getHealthToneClass,
  getStatusItems,
  getWorkerStatusDisplay,
  isQueueEmpty
} from "./queue-observability-panel-model";
import type { QueueObservability } from "../../server/queue-observability";

function data(overrides: Partial<QueueObservability["totals"]> = {}): QueueObservability {
  return {
    organizationId: "org-1",
    generatedAt: "2026-05-28T10:00:00.000Z",
    totals: {
      total: 0,
      queued: 0,
      running: 0,
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
    recentJobs: []
  };
}

describe("queue observability panel model", () => {
  it("maps status counts in operational priority order", () => {
    const items = getStatusItems(data({ total: 9, queued: 3, running: 1, failed: 2, succeeded: 3 }));

    expect(items.map((item) => item.key)).toEqual(["queued", "running", "failed", "succeeded", "cancelled"]);
    expect(items[0]).toMatchObject({ label: "排队", value: 3, tone: "queued", width: "100%" });
    expect(items[1]).toMatchObject({ label: "运行", value: 1, tone: "running", width: "33%" });
    expect(items[4]).toMatchObject({ label: "取消", value: 0, tone: "cancelled", width: "0%" });
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

  it("maps worker heartbeat status to readable labels and tones", () => {
    expect(getWorkerStatusDisplay("online")).toEqual({ label: "在线", tone: "online" });
    expect(getWorkerStatusDisplay("stale")).toEqual({ label: "过期", tone: "stale" });
  });
});
