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
      projectMemory: {
        create: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
      };
      generationStep: { create: ReturnType<typeof vi.fn> };
      generationJob: { update: ReturnType<typeof vi.fn> };
    }
    const tx: TxStub = {
      projectMemory: {
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
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

  it("writes the chapter summary as accepted and supersedes older states", async () => {
    const tx = {
      projectMemory: {
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ content: "旧记忆" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      generationStep: { create: vi.fn().mockResolvedValue({}) },
      generationJob: { update: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", content: "正文", title: "章", chapterNo: 1 })
      },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
    };

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus: vi.fn().mockResolvedValue({}), model: stubModel as never
    });

    await handler(baseJob);

    // 章节摘要直接写为 accepted（生成上下文只读 accepted，堆在 proposed 里等于没有）
    const created = tx.projectMemory.create.mock.calls.map((call) => call[0] as { data: Record<string, unknown> });
    const summaryCreate = created.find((c) => c.data.memoryType === "chapter_summary");
    expect(summaryCreate).toBeDefined();
    expect(summaryCreate!.data.status).toBe("accepted");

    // 同章旧摘要被淘汰
    expect(tx.projectMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ memoryType: "chapter_summary", scopeId: "chapter-1" }),
        data: { status: "superseded" }
      })
    );

    // 写入主角新状态前，淘汰主角的更早状态
    expect(tx.projectMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memoryType: "character_state",
          content: { startsWith: "主角: " }
        }),
        data: { status: "superseded" }
      })
    );
  });

  it("skips creating a memory whose content already exists", async () => {
    const tx = {
      projectMemory: {
        create: vi.fn().mockResolvedValue({}),
        // 与模型输出完全相同的世界事实 → 应被去重跳过
        findMany: vi.fn().mockResolvedValue([{ content: "这个世界有九层" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      generationStep: { create: vi.fn().mockResolvedValue({}) },
      generationJob: { update: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", content: "正文", title: "章", chapterNo: 1 })
      },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
    };

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus: vi.fn().mockResolvedValue({}), model: stubModel as never
    });

    await handler(baseJob);

    const worldFactCreates = tx.projectMemory.create.mock.calls
      .map((call) => call[0] as { data: Record<string, unknown> })
      .filter((c) => c.data.memoryType === "world_fact");
    expect(worldFactCreates).toHaveLength(0);
  });
});
