import { describe, expect, it, vi } from "vitest";
import {
  createGenerateChapterHandler,
  commitFinalize
} from "./generate-chapter-handler";
import type { GenerationJob } from "../poll";

const baseJob: GenerationJob = {
  id: "job-1",
  organizationId: "org-1",
  projectId: "proj-1",
  userId: "user-1",
  jobType: "GENERATE_CHAPTER",
  status: "RUNNING",
  input: {},
  targetEntityType: "CHAPTER",
  targetEntityId: "chapter-1"
};

function createTxStub(overrides: Partial<TxStub> = {}): TxStub {
  return {
    chapter: {
      findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", projectId: "proj-1" }),
      update: vi.fn().mockResolvedValue({})
    },
    contentVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "ver-1", versionNo: 1 })
    },
    generationStep: {
      create: vi.fn().mockResolvedValue({ id: "step-finalize" }),
      update: vi.fn().mockResolvedValue({})
    },
    generationJob: {
      update: vi.fn().mockResolvedValue({})
    },
    ...overrides
  };
}

interface TxStub {
  chapter: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contentVersion: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  generationStep: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  generationJob: { update: ReturnType<typeof vi.fn> };
}

interface PrismaStubOptions {
  chapterMissing?: boolean;
  txThrowsOn?: "contentVersion.create";
}

function createPrismaStub(options: PrismaStubOptions = {}) {
  const tx =
    options.txThrowsOn === "contentVersion.create"
      ? createTxStub({
          contentVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockRejectedValue(new Error("commit failed"))
          }
        })
      : createTxStub();

  const outerChapter = options.chapterMissing
    ? null
    : { id: "chapter-1", projectId: "proj-1", organizationId: "org-1" };

  const prisma = {
    chapter: {
      findFirst: vi.fn().mockResolvedValue(outerChapter)
    },
    generationStep: {
      create: vi.fn().mockResolvedValue({ id: "step-x" }),
      update: vi.fn().mockResolvedValue({})
    },
    $transaction: vi.fn(async (cb: (tx: TxStub) => Promise<unknown>) => cb(tx))
  };
  return { prisma, tx };
}

const stubModel = {
  generate: vi.fn().mockResolvedValue({
    text: "第一章 终稿正文",
    inputTokens: 100,
    outputTokens: 50
  })
};

describe("createGenerateChapterHandler", () => {
  it("commits chapter, content version, finalize step, and job inside a single tx", async () => {
    const { prisma, tx } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "chapter-1" },
        data: expect.objectContaining({
          wordCount: expect.any(Number),
          updatedById: "user-1",
          lastGeneratedJobId: "job-1"
        })
      })
    );
    expect(tx.contentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          projectId: "proj-1",
          entityType: "CHAPTER",
          entityId: "chapter-1",
          versionNo: 1,
          source: "AI",
          generationJobId: "job-1",
          createdById: "user-1"
        })
      })
    );
    expect(tx.generationStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: "job-1",
          stepKey: "finalize",
          status: "SUCCEEDED",
          organizationId: "org-1"
        })
      })
    );
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          progress: "100",
          output: expect.objectContaining({
            chapterId: "chapter-1",
            versionId: "ver-1",
            versionNo: 1
          })
        })
      })
    );
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("marks job FAILED with CHAPTER_NOT_FOUND when chapter is missing", async () => {
    const { prisma, tx } = createPrismaStub({ chapterMissing: true });
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "FAILED",
        errorCode: "CHAPTER_NOT_FOUND"
      })
    );
    expect(tx.chapter.update).not.toHaveBeenCalled();
    expect(tx.contentVersion.create).not.toHaveBeenCalled();
  });

  it("rolls back and marks FINALIZE_FAILED when contentVersion.create throws inside tx", async () => {
    const { prisma, tx } = createPrismaStub({ txThrowsOn: "contentVersion.create" });
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.chapter.update).toHaveBeenCalledOnce();
    expect(tx.contentVersion.create).toHaveBeenCalledOnce();
    expect(tx.generationStep.create).not.toHaveBeenCalled();
    expect(tx.generationJob.update).not.toHaveBeenCalled();

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "FAILED",
        errorCode: "FINALIZE_FAILED",
        errorMessage: expect.stringContaining("commit failed")
      })
    );
  });

  it("prefers targetEntityId over input.chapterId when resolving chapter", async () => {
    const { prisma } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler({
      ...baseJob,
      targetEntityType: "CHAPTER",
      targetEntityId: "chapter-1",
      input: { chapterId: "should-be-ignored" }
    });

    expect(prisma.chapter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "chapter-1" })
      })
    );
  });
});

describe("commitFinalize", () => {
  it("computes nextVersionNo as max+1 when versions exist", async () => {
    const tx = createTxStub({
      contentVersion: {
        findFirst: vi.fn().mockResolvedValue({ versionNo: 4 }),
        create: vi.fn().mockResolvedValue({ id: "ver-5", versionNo: 5 })
      }
    });
    const prisma = {
      $transaction: vi.fn(async (cb: (tx: TxStub) => Promise<unknown>) => cb(tx))
    } as never;

    const out = await commitFinalize({
      prisma,
      job: baseJob,
      chapter: { id: "chapter-1", projectId: "proj-1", organizationId: "org-1" },
      finalContent: "content",
      wordCount: 7
    });

    expect(out.versionNo).toBe(5);
    expect(tx.contentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNo: 5 })
      })
    );
  });
});
