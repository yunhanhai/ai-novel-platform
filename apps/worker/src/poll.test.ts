import { describe, expect, it, vi } from "vitest";
import { createPoller } from "./poll";

function mockClaimFn(result: unknown) {
  return vi.fn<() => Promise<typeof result>>().mockResolvedValue(result);
}

function mockUpdateFn() {
  return vi.fn<() => Promise<unknown>>().mockResolvedValue({});
}

function retryDeps(overrides: Record<string, unknown> = {}) {
  return {
    updateJobStatus: mockUpdateFn(),
    scheduleJobRetry: vi.fn().mockResolvedValue({}),
    markJobFailed: vi.fn().mockResolvedValue({}),
    recoverExpiredLeases: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 }),
    now: () => new Date("2026-05-28T10:00:00.000Z"),
    ...overrides
  };
}

const baseJob = {
  id: "j1", organizationId: "org1", projectId: "p1", userId: "u1",
  modelProfileId: null, jobType: "GENERATE_CHAPTER" as const,
  targetEntityType: "CHAPTER" as const, targetEntityId: "c1",
  status: "RUNNING" as const, input: {}, output: null,
  errorCode: null, errorMessage: null, progress: "0",
  lockKey: null, leaseExpiresAt: null,
  attemptCount: 0, maxAttempts: 3, nextRunAt: null,
  startedAt: null, finishedAt: null, createdAt: new Date()
};

describe("poller", () => {
  it("does nothing when no job is available", async () => {
    const handler = vi.fn();
    const deps = retryDeps();
    const poller = createPoller({
      claimNext: vi.fn().mockResolvedValue(null),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]]),
      ...deps
    });

    const result = await poller.tick();

    expect(result).toBe("no_job");
    expect(deps.recoverExpiredLeases).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("processes a claimed job through its handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]]),
      ...retryDeps()
    });

    const result = await poller.tick();

    expect(result).toBe("processed");
    expect(handler).toHaveBeenCalledWith(baseJob);
  });

  it("schedules a retry when handler throws and attempts remain", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const scheduleJobRetry = vi.fn().mockResolvedValue({});
    const markJobFailed = vi.fn().mockResolvedValue({});
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]]),
      ...retryDeps({ scheduleJobRetry, markJobFailed })
    });

    const result = await poller.tick();

    expect(result).toBe("error");
    expect(scheduleJobRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        attemptCount: 0,
        errorCode: "HANDLER_ERROR",
        errorMessage: "boom",
        now: new Date("2026-05-28T10:00:00.000Z")
      })
    );
    expect(markJobFailed).not.toHaveBeenCalled();
  });

  it("marks handler failures final when attempts are exhausted", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const scheduleJobRetry = vi.fn().mockResolvedValue({});
    const markJobFailed = vi.fn().mockResolvedValue({});
    const poller = createPoller({
      claimNext: () => Promise.resolve({ ...baseJob, attemptCount: 2, maxAttempts: 3 }),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]]),
      ...retryDeps({ scheduleJobRetry, markJobFailed })
    });

    await poller.tick();

    expect(scheduleJobRetry).not.toHaveBeenCalled();
    expect(markJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        errorCode: "HANDLER_ERROR",
        errorMessage: "boom",
        now: new Date("2026-05-28T10:00:00.000Z")
      })
    );
  });

  it("marks no-handler jobs failed", async () => {
    const markJobFailed = vi.fn().mockResolvedValue({});
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      pollIntervalMs: 10,
      handlers: new Map(),
      ...retryDeps({ markJobFailed })
    });

    const result = await poller.tick();

    expect(result).toBe("no_handler");
    expect(markJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        errorCode: "NO_HANDLER"
      })
    );
  });
});
