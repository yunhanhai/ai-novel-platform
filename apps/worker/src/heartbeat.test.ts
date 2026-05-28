import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerHeartbeat } from "./heartbeat";

describe("worker heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes an immediate heartbeat and refreshes periodically", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const heartbeat = createWorkerHeartbeat({
      organizationId: "org-1",
      lockKey: "worker-1",
      pid: 42,
      startedAt: new Date("2026-05-28T09:59:00.000Z"),
      pollIntervalMs: 1000,
      leaseDurationMs: 120000,
      heartbeatIntervalMs: 10_000,
      upsert
    });
    const controller = new AbortController();

    const started = heartbeat.start(controller.signal);
    await flushPromises();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      organizationId: "org-1",
      lockKey: "worker-1",
      pid: 42,
      startedAt: new Date("2026-05-28T09:59:00.000Z"),
      lastSeenAt: new Date("2026-05-28T10:00:00.000Z"),
      pollIntervalMs: 1000,
      leaseDurationMs: 120000
    }));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      lastSeenAt: new Date("2026-05-28T10:00:10.000Z")
    }));

    controller.abort();
    await started;
  });

  it("includes the latest poll tick status in subsequent heartbeats", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const heartbeat = createWorkerHeartbeat({
      organizationId: "org-1",
      lockKey: "worker-1",
      pid: 42,
      startedAt: new Date("2026-05-28T09:59:00.000Z"),
      pollIntervalMs: 1000,
      leaseDurationMs: 120000,
      heartbeatIntervalMs: 10_000,
      upsert
    });
    const controller = new AbortController();

    const started = heartbeat.start(controller.signal);
    await flushPromises();
    heartbeat.reportTick("processed", new Date("2026-05-28T10:00:04.000Z"));

    vi.setSystemTime(new Date("2026-05-28T10:00:10.000Z"));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      lastTickStatus: "processed",
      lastTickAt: new Date("2026-05-28T10:00:04.000Z")
    }));

    controller.abort();
    await started;
  });

  it("keeps running when a heartbeat write fails", async () => {
    const upsert = vi
      .fn()
      .mockRejectedValueOnce(new Error("database offline"))
      .mockResolvedValueOnce({});
    const warn = vi.fn();
    const heartbeat = createWorkerHeartbeat({
      organizationId: "org-1",
      lockKey: "worker-1",
      pid: 42,
      startedAt: new Date("2026-05-28T09:59:00.000Z"),
      pollIntervalMs: 1000,
      leaseDurationMs: 120000,
      heartbeatIntervalMs: 10_000,
      upsert,
      warn
    });
    const controller = new AbortController();

    const started = heartbeat.start(controller.signal);
    await flushPromises();
    vi.setSystemTime(new Date("2026-05-28T10:00:10.000Z"));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("database offline"));

    controller.abort();
    await started;
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
