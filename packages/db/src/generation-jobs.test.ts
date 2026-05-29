import { describe, expect, it, vi } from "vitest";
import {
  createJob,
  claimNextJob,
  releaseJobLease,
  updateJobStatus,
  createStep,
  updateStep,
  computeRetryDelayMs,
  scheduleJobRetry,
  markJobFailed,
  recoverExpiredJobLeases,
  retryFailedJob
} from "./generation-jobs";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    generationJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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

type ClaimTxStub = {
  generationJob: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const job = {
  id: "j1", organizationId: "org1", projectId: "p1", userId: "u1",
  modelProfileId: null, jobType: "GENERATE_CHAPTER",
  targetEntityType: "CHAPTER", targetEntityId: "c1",
  status: "QUEUED", input: {}, output: null,
  errorCode: null, errorMessage: null, progress: "0",
  lockKey: null, leaseExpiresAt: null,
  attemptCount: 0, maxAttempts: 3, nextRunAt: null,
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
      const createMock = vi.fn().mockResolvedValue(job);
      const prisma = mockPrisma({ generationJob: { create: createMock } });

      const result = await createJob({
        organizationId: "org1", projectId: "p1", userId: "u1",
        jobType: "GENERATE_CHAPTER", input: { chapterId: "c1" },
        targetEntityType: "CHAPTER", targetEntityId: "c1", prisma
      });

      expect(result.status).toBe("QUEUED");
      expect(result.jobType).toBe("GENERATE_CHAPTER");
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attemptCount: 0,
            maxAttempts: 3,
            nextRunAt: null
          })
        })
      );
    });

    it("creates chapter diagnostic jobs", async () => {
      const diagnosticJob = {
        ...job,
        jobType: "DIAGNOSE_CHAPTER",
        targetEntityType: "CHAPTER",
        targetEntityId: "c1",
        input: { chapterId: "c1" }
      };
      const createMock = vi.fn().mockResolvedValue(diagnosticJob);
      const prisma = mockPrisma({ generationJob: { create: createMock } });

      const result = await createJob({
        organizationId: "org1",
        projectId: "p1",
        userId: "u1",
        jobType: "DIAGNOSE_CHAPTER",
        targetEntityType: "CHAPTER",
        targetEntityId: "c1",
        input: { chapterId: "c1" },
        prisma
      });

      expect(result.jobType).toBe("DIAGNOSE_CHAPTER");
      expect(result.targetEntityType).toBe("CHAPTER");
      expect(result.targetEntityId).toBe("c1");
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobType: "DIAGNOSE_CHAPTER",
            targetEntityType: "CHAPTER",
            targetEntityId: "c1"
          })
        })
      );
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

    it("does not claim queued jobs scheduled for a future retry", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const tx: ClaimTxStub = {
        generationJob: {
          findFirst,
          update: vi.fn()
        }
      };
      const prisma = mockPrisma({
        $transaction: vi.fn((cb: (tx: ClaimTxStub) => Promise<unknown>) => cb(tx))
      });
      const now = new Date("2026-05-28T10:00:00.000Z");

      await claimNextJob({
        organizationId: "org1",
        lockKey: "worker-1",
        leaseDurationMs: 60_000,
        now,
        prisma
      });

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { nextRunAt: null },
              { nextRunAt: { lte: now } }
            ]
          })
        })
      );
    });
  });

  describe("retry helpers", () => {
    it("uses a bounded retry delay schedule", () => {
      expect(computeRetryDelayMs(1)).toBe(10_000);
      expect(computeRetryDelayMs(2)).toBe(30_000);
      expect(computeRetryDelayMs(3)).toBe(120_000);
      expect(computeRetryDelayMs(10)).toBe(120_000);
    });

    it("schedules a retry by incrementing attempts and clearing lease fields", async () => {
      const update = vi.fn().mockResolvedValue({
        ...job,
        attemptCount: 1,
        nextRunAt: new Date("2026-05-28T10:00:10.000Z")
      });
      const prisma = mockPrisma({ generationJob: { update } });

      const result = await scheduleJobRetry({
        jobId: "j1",
        attemptCount: 0,
        errorCode: "HANDLER_ERROR",
        errorMessage: "timeout",
        now: new Date("2026-05-28T10:00:00.000Z"),
        prisma
      });

      expect(result.attemptCount).toBe(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: "j1" },
        data: expect.objectContaining({
          status: "QUEUED",
          attemptCount: { increment: 1 },
          nextRunAt: new Date("2026-05-28T10:00:10.000Z"),
          lockKey: null,
          leaseExpiresAt: null,
          startedAt: null,
          errorCode: "HANDLER_ERROR",
          errorMessage: "timeout"
        })
      });
    });

    it("marks a job as finally failed when attempts are exhausted", async () => {
      const update = vi.fn().mockResolvedValue({
        ...job,
        status: "FAILED",
        attemptCount: 3,
        errorCode: "HANDLER_ERROR"
      });
      const prisma = mockPrisma({ generationJob: { update } });

      const result = await markJobFailed({
        jobId: "j1",
        errorCode: "HANDLER_ERROR",
        errorMessage: "timeout",
        now: new Date("2026-05-28T10:00:00.000Z"),
        prisma
      });

      expect(result.status).toBe("FAILED");
      expect(update).toHaveBeenCalledWith({
        where: { id: "j1" },
        data: expect.objectContaining({
          status: "FAILED",
          finishedAt: new Date("2026-05-28T10:00:00.000Z"),
          lockKey: null,
          leaseExpiresAt: null,
          nextRunAt: null,
          errorCode: "HANDLER_ERROR",
          errorMessage: "timeout"
        })
      });
    });

    it("manually retries a failed job for the same organization", async () => {
      const failed = {
        ...job,
        status: "FAILED",
        progress: "45",
        errorCode: "HANDLER_ERROR",
        errorMessage: "timeout",
        lockKey: "worker-1",
        leaseExpiresAt: new Date("2026-05-28T09:59:00.000Z"),
        nextRunAt: new Date("2026-05-28T10:02:00.000Z"),
        startedAt: new Date("2026-05-28T09:58:00.000Z"),
        finishedAt: new Date("2026-05-28T10:00:00.000Z")
      };
      const retried = {
        ...failed,
        status: "QUEUED",
        progress: "0",
        errorCode: null,
        errorMessage: null,
        lockKey: null,
        leaseExpiresAt: null,
        nextRunAt: null,
        startedAt: null,
        finishedAt: null
      };
      const findFirst = vi.fn().mockResolvedValue(failed);
      const update = vi.fn().mockResolvedValue(retried);
      const prisma = mockPrisma({ generationJob: { findFirst, update } });

      const result = await retryFailedJob({
        organizationId: "org1",
        jobId: "j1",
        prisma
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.job.status).toBe("QUEUED");
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: "j1", organizationId: "org1" },
        select: { id: true, status: true }
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "j1" },
        data: expect.objectContaining({
          status: "QUEUED",
          progress: "0",
          errorCode: null,
          errorMessage: null,
          lockKey: null,
          leaseExpiresAt: null,
          nextRunAt: null,
          startedAt: null,
          finishedAt: null
        })
      });
    });

    it("does not retry jobs outside the organization", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const update = vi.fn();
      const prisma = mockPrisma({ generationJob: { findFirst, update } });

      const result = await retryFailedJob({
        organizationId: "org1",
        jobId: "j-other",
        prisma
      });

      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(update).not.toHaveBeenCalled();
    });

    it("does not retry jobs that are not failed", async () => {
      const findFirst = vi.fn().mockResolvedValue({ id: "j1", status: "RUNNING" });
      const update = vi.fn();
      const prisma = mockPrisma({ generationJob: { findFirst, update } });

      const result = await retryFailedJob({
        organizationId: "org1",
        jobId: "j1",
        prisma
      });

      expect(result).toEqual({ ok: false, reason: "invalid_status", status: "RUNNING" });
      expect(update).not.toHaveBeenCalled();
    });

    it("recovers expired running leases back to delayed queued jobs", async () => {
      const expired = { ...job, id: "expired-1", status: "RUNNING", attemptCount: 1, maxAttempts: 3 };
      const findMany = vi.fn().mockResolvedValue([expired]);
      const update = vi.fn().mockResolvedValue({
        ...expired,
        status: "QUEUED",
        attemptCount: 2,
        nextRunAt: new Date("2026-05-28T10:00:30.000Z")
      });
      const prisma = mockPrisma({ generationJob: { findMany, update } });

      const result = await recoverExpiredJobLeases({
        organizationId: "org1",
        now: new Date("2026-05-28T10:00:00.000Z"),
        limit: 5,
        prisma
      });

      expect(result.recovered).toBe(1);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org1",
          status: "RUNNING",
          leaseExpiresAt: { lt: new Date("2026-05-28T10:00:00.000Z") }
        },
        orderBy: { leaseExpiresAt: "asc" },
        take: 5
      });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "expired-1" },
          data: expect.objectContaining({
            status: "QUEUED",
            attemptCount: { increment: 1 },
            nextRunAt: new Date("2026-05-28T10:00:30.000Z"),
            lockKey: null,
            leaseExpiresAt: null,
            startedAt: null,
            errorCode: "LEASE_EXPIRED"
          })
        })
      );
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
