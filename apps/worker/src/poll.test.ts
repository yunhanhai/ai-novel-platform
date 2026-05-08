import { describe, expect, it, vi } from "vitest";
import { createPoller } from "./poll";

function mockClaimFn(result: unknown) {
  return vi.fn<() => Promise<typeof result>>().mockResolvedValue(result);
}

function mockUpdateFn() {
  return vi.fn<() => Promise<unknown>>().mockResolvedValue({});
}

const baseJob = {
  id: "j1", organizationId: "org1", projectId: "p1", userId: "u1",
  modelProfileId: null, jobType: "GENERATE_CHAPTER" as const,
  targetEntityType: "CHAPTER" as const, targetEntityId: "c1",
  status: "RUNNING" as const, input: {}, output: null,
  errorCode: null, errorMessage: null, progress: "0",
  lockKey: null, leaseExpiresAt: null,
  startedAt: null, finishedAt: null, createdAt: new Date()
};

describe("poller", () => {
  it("does nothing when no job is available", async () => {
    const handler = vi.fn();
    const poller = createPoller({
      claimNext: () => Promise.resolve(null),
      updateJobStatus: mockUpdateFn(),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("no_job");
    expect(handler).not.toHaveBeenCalled();
  });

  it("processes a claimed job through its handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      updateJobStatus: mockUpdateFn(),
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    const result = await poller.tick();

    expect(result).toBe("processed");
    expect(handler).toHaveBeenCalledWith(baseJob);
  });

  it("marks job failed when handler throws", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      updateJobStatus,
      pollIntervalMs: 10,
      handlers: new Map([["GENERATE_CHAPTER", handler]])
    });

    await poller.tick();

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", status: "FAILED" })
    );
  });

  it("ignores jobs with no registered handler", async () => {
    const poller = createPoller({
      claimNext: () => Promise.resolve(baseJob),
      updateJobStatus: mockUpdateFn(),
      pollIntervalMs: 10,
      handlers: new Map()
    });

    const result = await poller.tick();

    expect(result).toBe("no_handler");
  });
});
