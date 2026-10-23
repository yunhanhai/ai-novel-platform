import { describe, expect, it, vi } from "vitest";
import { backoffDelayMs, createPoller } from "./poll";

function mockUpdateFn() {
  return vi.fn<() => Promise<unknown>>().mockResolvedValue({});
}

function mockRequeueFn() {
  return vi.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue({});
}

const baseJob = {
  id: "j1", organizationId: "org1", projectId: "p1", userId: "u1",
  modelProfileId: null, jobType: "GENERATE_CHAPTER" as const,
  targetEntityType: "CHAPTER" as const, targetEntityId: "c1",
  status: "RUNNING" as const, input: {}, output: null,
  errorCode: null, errorMessage: null, progress: "0",
  lockKey: null, leaseExpiresAt: null,
  attemptCount: 1, maxAttempts: 3,
  startedAt: null, finishedAt: null, createdAt: new Date()
};

describe("poller", () => {
  it("does nothing when no job is available", async () => {
    const handler = vi.fn();
    const poller = createPoller({
      claimNext: () => Promise.resolve(null),
      updateJobStatus: mockUpdateFn(),
      requeueForRetry: mockRequeueFn(),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("no_job");
    expect(handler).not.toHaveBeenCalled();
  });

  it("processes a claimed job through its handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const updateJobStatus = mockUpdateFn();
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      updateJobStatus,
      requeueForRetry: mockRequeueFn(),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("processed");
    expect(handler).toHaveBeenCalledWith(baseJob);
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("requeues a job for retry when handler throws and attempts remain", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const updateJobStatus = mockUpdateFn();
    const requeueForRetry = mockRequeueFn();
    const poller = createPoller({
      claimNext: () => Promise.resolve({ ...baseJob, attemptCount: 1, maxAttempts: 3 }),
      updateJobStatus,
      requeueForRetry,
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("retried");
    expect(requeueForRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        attemptCount: 1,
        errorMessage: "boom"
      })
    );
    expect((requeueForRetry.mock.calls[0]![0] as { nextRunAt: Date }).nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("fails immediately with a readable message on model config errors", async () => {
    // 401 是永久性配置错误：重试三次还是 401，只会浪费时间
    const handler = vi.fn().mockRejectedValue(
      Object.assign(new Error("Incorrect API key provided"), { status: 401 })
    );
    const updateJobStatus = mockUpdateFn();
    const requeueForRetry = mockRequeueFn();
    const poller = createPoller({
      claimNext: () => Promise.resolve({ ...baseJob, attemptCount: 1, maxAttempts: 3 }),
      updateJobStatus,
      requeueForRetry,
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("error");
    expect(requeueForRetry).not.toHaveBeenCalled();
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        status: "FAILED",
        errorCode: "MODEL_CONFIG_ERROR",
        errorMessage: expect.stringContaining("API key")
      })
    );
  });

  it("still retries rate-limit errors", async () => {
    const handler = vi.fn().mockRejectedValue(
      Object.assign(new Error("Too many requests"), { status: 429 })
    );
    const updateJobStatus = mockUpdateFn();
    const requeueForRetry = mockRequeueFn();
    const poller = createPoller({
      claimNext: () => Promise.resolve({ ...baseJob, attemptCount: 1, maxAttempts: 3 }),
      updateJobStatus,
      requeueForRetry,
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("retried");
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("retries jobs without attempt metadata (legacy rows default to attempt 1)", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const requeueForRetry = mockRequeueFn();
    const poller = createPoller({
      claimNext: () => Promise.resolve({ ...baseJob, attemptCount: undefined, maxAttempts: undefined }),
      updateJobStatus: mockUpdateFn(),
      requeueForRetry,
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("retried");
    expect(requeueForRetry).toHaveBeenCalledWith(expect.objectContaining({ attemptCount: 1 }));
  });

  it("marks job failed when attempts are exhausted", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const updateJobStatus = mockUpdateFn();
    const requeueForRetry = mockRequeueFn();
    const poller = createPoller({
      claimNext: () => Promise.resolve({ ...baseJob, attemptCount: 3, maxAttempts: 3 }),
      updateJobStatus,
      requeueForRetry,
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("error");
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        status: "FAILED",
        errorCode: "HANDLER_ERROR",
        errorMessage: expect.stringContaining("已重试 2 次后放弃")
      })
    );
    expect(requeueForRetry).not.toHaveBeenCalled();
  });

  it("marks no-handler jobs failed without retrying", async () => {
    const updateJobStatus = mockUpdateFn();
    const requeueForRetry = mockRequeueFn();
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      updateJobStatus,
      requeueForRetry,
      pollIntervalMs: 10,
      handlers: new Map()
    });

    const result = await poller.tick();

    expect(result).toBe("no_handler");
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        status: "FAILED",
        errorCode: "NO_HANDLER"
      })
    );
    expect(requeueForRetry).not.toHaveBeenCalled();
  });

  describe("backoffDelayMs", () => {
    it("grows exponentially and caps at 10 minutes", () => {
      expect(backoffDelayMs(1)).toBe(15_000);
      expect(backoffDelayMs(2)).toBe(30_000);
      expect(backoffDelayMs(3)).toBe(60_000);
      expect(backoffDelayMs(7)).toBe(10 * 60_000);
    });
  });
});
