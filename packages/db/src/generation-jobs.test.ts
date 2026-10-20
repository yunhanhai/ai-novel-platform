import { describe, expect, it, vi } from "vitest";
import { createJob, claimNextJob, requeueJobForRetry, releaseJobLease, updateJobStatus, createStep, updateStep } from "./generation-jobs";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    generationJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    generationStep: {
      create: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma(overrides))),
    ...overrides
  } as unknown as Parameters<typeof createJob>[0]["prisma"];
}

const job = {
  id: "j1", organizationId: "org1", projectId: "p1", userId: "u1",
  modelProfileId: null, jobType: "GENERATE_CHAPTER",
  targetEntityType: "CHAPTER", targetEntityId: "c1",
  status: "QUEUED", input: {}, output: null,
  errorCode: null, errorMessage: null, progress: "0",
  lockKey: null, leaseExpiresAt: null,
  startedAt: null, finishedAt: null, createdAt: new Date()
};

const step = {
  id: "s1", organizationId: "org1", jobId: "j1", stepKey: "draft",
  status: "PENDING", modelProfileId: null, promptSnapshot: null,
  inputTokens: null, outputTokens: null, latencyMs: null,
  outputPreview: null, errorMessage: null,
  startedAt: null, finishedAt: null
};

describe("generation-jobs", () => {
  describe("createJob", () => {
    it("creates a queued generation job", async () => {
      const prisma = mockPrisma({ generationJob: { create: vi.fn().mockResolvedValue(job) } });

      const result = await createJob({
        organizationId: "org1", projectId: "p1", userId: "u1",
        jobType: "GENERATE_CHAPTER", input: { chapterId: "c1" },
        targetEntityType: "CHAPTER", targetEntityId: "c1", prisma
      });

      expect(result.status).toBe("QUEUED");
      expect(result.jobType).toBe("GENERATE_CHAPTER");
    });

    it("creates chapter diagnostic jobs", async () => {
      const diagnosticJob = { ...job, jobType: "DIAGNOSE_CHAPTER", targetEntityType: "CHAPTER", targetEntityId: "c1" };
      const prisma = mockPrisma({ generationJob: { create: vi.fn().mockResolvedValue(diagnosticJob) } });

      const result = await createJob({
        organizationId: "org1", projectId: "p1", userId: "u1",
        jobType: "DIAGNOSE_CHAPTER",
        targetEntityType: "CHAPTER", targetEntityId: "c1",
        input: { chapterId: "c1" }, prisma
      });

      expect(result.jobType).toBe("DIAGNOSE_CHAPTER");
      expect(result.targetEntityType).toBe("CHAPTER");
      expect(result.targetEntityId).toBe("c1");
    });
  });

  describe("claimNextJob", () => {
    it("returns null when no jobs available", async () => {
      const prisma = mockPrisma({
        $transaction: vi.fn(async () => null)
      });

      const result = await claimNextJob({
        organizationId: "org1", lockKey: "worker-1",
        leaseDurationMs: 60_000, prisma
      });

      expect(result).toBeNull();
    });

    it("returns claimed job when one is available", async () => {
      const claimed = { ...job, status: "RUNNING", lockKey: "worker-1" };
      const prisma = mockPrisma({
        $transaction: vi.fn(async () => claimed)
      });

      const result = await claimNextJob({
        organizationId: "org1", lockKey: "worker-1",
        leaseDurationMs: 60_000, prisma
      });

      expect(result).not.toBeNull();
      expect(result!.status).toBe("RUNNING");
    });

    it("claims across organizations when organizationId is omitted", async () => {
      const claimed = { ...job, status: "RUNNING", lockKey: "worker-1" };
      const prisma = mockPrisma({
        $transaction: vi.fn(async () => claimed)
      });

      const result = await claimNextJob({
        lockKey: "worker-1",
        leaseDurationMs: 60_000,
        prisma
      });

      expect(result).not.toBeNull();
      expect(result!.organizationId).toBe("org1");
    });

    it("only claims due or orphaned work and increments attemptCount", async () => {
      const txFindFirst = vi.fn().mockResolvedValue(job);
      const txUpdate = vi.fn().mockResolvedValue({ ...job, status: "RUNNING", lockKey: "worker-1", attemptCount: 1 });
      const prisma = mockPrisma({
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            generationJob: { findFirst: txFindFirst, update: txUpdate }
          } as never)
        )
      });

      await claimNextJob({ lockKey: "worker-1", leaseDurationMs: 60_000, prisma });

      const where = (txFindFirst.mock.calls[0]![0] as { where: { OR: Array<Record<string, unknown>> } }).where;
      const shapes = JSON.stringify(where.OR);
      expect(shapes).toContain('"status":"QUEUED"');
      expect(shapes).toContain('"nextRunAt":null');
      expect(shapes).toContain('"nextRunAt":{"lte"');
      expect(shapes).toContain('"status":"RUNNING","leaseExpiresAt":{"lt"');

      const updateArgs = txUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(updateArgs.data.attemptCount).toEqual({ increment: 1 });
      expect(updateArgs.data.status).toBe("RUNNING");
    });
  });

  describe("requeueJobForRetry", () => {
    it("requeues with attempt count, backoff time and cleared lease", async () => {
      const update = vi.fn().mockResolvedValue({ ...job, status: "QUEUED", attemptCount: 1 });
      const prisma = mockPrisma({ generationJob: { update } });
      const nextRunAt = new Date(Date.now() + 15_000);

      const result = await requeueJobForRetry({
        jobId: "j1",
        attemptCount: 1,
        nextRunAt,
        errorMessage: "boom",
        prisma
      });

      expect(result).toEqual(expect.objectContaining({ status: "QUEUED" }));
      expect(update).toHaveBeenCalledWith({
        where: { id: "j1" },
        data: {
          status: "QUEUED",
          attemptCount: 1,
          nextRunAt,
          lockKey: null,
          leaseExpiresAt: null,
          errorCode: "HANDLER_RETRY",
          errorMessage: "boom"
        }
      });
    });
  });

  describe("releaseJobLease", () => {
    it("clears lease fields", async () => {
      const prisma = mockPrisma({
        generationJob: { update: vi.fn().mockResolvedValue({ ...job, lockKey: null, leaseExpiresAt: null }) }
      });

      await expect(releaseJobLease("j1", "worker-1", prisma)).resolves.not.toThrow();
    });
  });

  describe("updateJobStatus", () => {
    it("updates to succeeded with output", async () => {
      const succeeded = { ...job, status: "SUCCEEDED", output: { text: "hello" }, progress: "100" };
      const prisma = mockPrisma({ generationJob: { update: vi.fn().mockResolvedValue(succeeded) } });

      const result = await updateJobStatus({
        jobId: "j1", status: "SUCCEEDED",
        output: { text: "hello" }, prisma
      });

      expect(result.status).toBe("SUCCEEDED");
    });

    it("updates to failed with error info", async () => {
      const failed = { ...job, status: "FAILED", errorCode: "MODEL_ERROR", errorMessage: "timeout" };
      const prisma = mockPrisma({ generationJob: { update: vi.fn().mockResolvedValue(failed) } });

      const result = await updateJobStatus({
        jobId: "j1", status: "FAILED",
        errorCode: "MODEL_ERROR", errorMessage: "timeout", prisma
      });

      expect(result.errorCode).toBe("MODEL_ERROR");
    });
  });

  describe("createStep", () => {
    it("creates a generation step with startedAt set", async () => {
      const createMock = vi.fn().mockResolvedValue(step);
      const prisma = mockPrisma({ generationStep: { create: createMock } });

      const result = await createStep({
        organizationId: "org1", jobId: "j1", stepKey: "draft", prisma
      });

      expect(result.stepKey).toBe("draft");
      expect(result.status).toBe("PENDING");
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stepKey: "draft",
            startedAt: expect.any(Date)
          })
        })
      );
    });
  });

  describe("updateStep", () => {
    it("updates step status and metrics", async () => {
      const updated = { ...step, status: "SUCCEEDED", outputPreview: "text", inputTokens: 100, outputTokens: 200 };
      const prisma = mockPrisma({ generationStep: { update: vi.fn().mockResolvedValue(updated) } });

      const result = await updateStep({
        stepId: "s1", status: "SUCCEEDED",
        outputPreview: "text", inputTokens: 100, outputTokens: 200, prisma
      });

      expect(result.status).toBe("SUCCEEDED");
      expect(result.outputTokens).toBe(200);
    });
  });
});
