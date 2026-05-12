import { describe, expect, it, vi } from "vitest";
import { createDeslopHandler } from "./deslop-handler";
import type { GenerationJob } from "../poll";

const baseJob: GenerationJob = {
  id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1",
  jobType: "DESLOP", status: "RUNNING", input: {},
  targetEntityType: "CHAPTER", targetEntityId: "chapter-1"
};

const stubModel = {
  generate: vi.fn().mockResolvedValue({
    text: '{"issues":[{"category":"stock_phrase","severity":"warning","matched":"仿佛","suggestion":"删除","position":{"start":0,"end":2}}],"overallScore":90,"summary":"有一处套话"}',
    inputTokens: 100, outputTokens: 50
  })
};

describe("createDeslopHandler", () => {
  it("analyzes chapter and saves report", async () => {
    interface TxStub {
      generationStep: { create: ReturnType<typeof vi.fn> };
      generationJob: { update: ReturnType<typeof vi.fn> };
    }
    const tx: TxStub = {
      generationStep: { create: vi.fn().mockResolvedValue({}) },
      generationJob: { update: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", content: "正文内容", title: "测试" })
      },
      $transaction: vi.fn(async (cb: (t: TxStub) => Promise<unknown>) => cb(tx))
    };
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createDeslopHandler({
      prisma: prisma as never, updateJobStatus, model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" })
      })
    );
    expect(tx.generationStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stepKey: "deslop_analyze" })
      })
    );
  });

  it("fails when chapter not found", async () => {
    const prisma = {
      chapter: { findFirst: vi.fn().mockResolvedValue(null) }
    };
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createDeslopHandler({
      prisma: prisma as never, updateJobStatus, model: stubModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
  });
});
