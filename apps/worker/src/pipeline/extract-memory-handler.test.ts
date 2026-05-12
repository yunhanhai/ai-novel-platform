import { describe, expect, it, vi } from "vitest";
import { createExtractMemoryHandler } from "./extract-memory-handler";
import type { GenerationJob } from "../poll";

const baseJob: GenerationJob = {
  id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1",
  jobType: "EXTRACT_MEMORY", status: "RUNNING", input: {},
  targetEntityType: "CHAPTER", targetEntityId: "chapter-1"
};

const stubModel = {
  generate: vi.fn().mockResolvedValue({
    text: '{"characterChanges":[{"characterName":"主角","change":"觉醒了新能力"}],"worldFacts":[{"fact":"这个世界有九层"}],"newHooks":[{"hook":"神秘人暗中观察"}],"summary":"主角觉醒","chapterSummary":"主角在危急时刻觉醒了新能力，同时神秘人暗中观察"}',
    inputTokens: 100, outputTokens: 80
  })
};

describe("createExtractMemoryHandler", () => {
  it("extracts memories and saves as proposed", async () => {
    interface TxStub {
      projectMemory: { create: ReturnType<typeof vi.fn> };
      generationStep: { create: ReturnType<typeof vi.fn> };
      generationJob: { update: ReturnType<typeof vi.fn> };
    }
    const tx: TxStub = {
      projectMemory: { create: vi.fn().mockResolvedValue({}) },
      generationStep: { create: vi.fn().mockResolvedValue({}) },
      generationJob: { update: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({
          id: "chapter-1", content: "正文内容", title: "测试", chapterNo: 1
        })
      },
      $transaction: vi.fn(async (cb: (t: TxStub) => Promise<unknown>) => cb(tx))
    };
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus, model: stubModel as never
    });

    await handler(baseJob);

    // 至少创建了一条 chapter_summary 记忆
    expect(tx.projectMemory.create).toHaveBeenCalled();
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" })
      })
    );
  });

  it("fails when chapter has no content", async () => {
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", content: null, title: "空" })
      }
    };
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus, model: stubModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
  });
});
