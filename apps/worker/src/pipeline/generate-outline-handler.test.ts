import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOutlinePrompt,
  createGenerateOutlineHandler,
  normalizeChapterCount,
  normalizeDraftedChapters
} from "./generate-outline-handler";
import type { GenerationJob } from "../poll";

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "proj-1",
    userId: "user-1",
    jobType: "GENERATE_OUTLINE",
    status: "RUNNING",
    input: { chapterCount: 2 },
    targetEntityType: "PROJECT",
    targetEntityId: "proj-1",
    ...overrides
  } as GenerationJob;
}

function makePrisma(existingChapterOrder: number[] = []) {
  const txCreate = vi.fn().mockImplementation((args: { data: { title: string; orderIndex: number } }) =>
    Promise.resolve({ id: `o-${args.data.orderIndex}`, title: args.data.title, orderIndex: args.data.orderIndex })
  );
  const prisma = {
    project: {
      findFirst: vi.fn().mockResolvedValue({
        id: "proj-1",
        title: "长夜",
        premise: "少年入京赶考",
        genre: "古装悬疑",
        styleBrief: "冷峻"
      })
    },
    outline: {
      findMany: vi.fn().mockResolvedValue(
        existingChapterOrder.map((orderIndex, index) => ({
          title: `旧章 ${index + 1}`,
          summary: "旧摘要",
          orderIndex
        }))
      ),
      findFirst: vi.fn().mockResolvedValue({ id: "vol-1" })
    },
    character: { findMany: vi.fn().mockResolvedValue([{ name: "林墨" }]) },
    worldItem: { findMany: vi.fn().mockResolvedValue([{ name: "枯槐" }]) },
    generationStep: {
      create: vi.fn().mockResolvedValue({ id: "step-1" }),
      update: vi.fn().mockResolvedValue({})
    },
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({ outline: { create: txCreate } }))
  };
  return { prisma: prisma as never, txCreate };
}

describe("normalizeChapterCount", () => {
  it("defaults, parses and clamps", () => {
    expect(normalizeChapterCount(undefined)).toBe(5);
    expect(normalizeChapterCount("3")).toBe(3);
    expect(normalizeChapterCount(0)).toBe(5);
    expect(normalizeChapterCount(999)).toBe(20);
  });
});

describe("normalizeDraftedChapters", () => {
  it("drops entries without a title and respects the limit", () => {
    const result = normalizeDraftedChapters(
      [
        { title: "第一章", summary: "摘要" },
        { summary: "无标题" },
        { title: "第二章", summary: "摘要" },
        { title: "第三章", summary: "摘要" },
        "nope"
      ],
      2
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title)).toEqual(["第一章", "第二章"]);
  });
});

describe("buildOutlinePrompt", () => {
  it("includes existing chapters, characters and the count", () => {
    const prompt = buildOutlinePrompt({
      projectTitle: "长夜",
      premise: "少年入京",
      genre: null,
      styleBrief: null,
      existingChapters: [{ title: "旧章", summary: "旧事" }],
      characterNames: ["林墨"],
      worldNames: ["枯槐"],
      chapterCount: 4
    });
    expect(prompt).toContain("4 章");
    expect(prompt).toContain("旧章");
    expect(prompt).toContain("林墨");
    expect(prompt).toContain("枯槐");
    expect(prompt).not.toContain("额外要求");
  });
});

describe("createGenerateOutlineHandler", () => {
  const updateJobStatus = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({});

  beforeEach(() => {
    updateJobStatus.mockClear();
  });

  it("creates chapter outlines continuing the existing order index", async () => {
    const { prisma, txCreate } = makePrisma([1, 2]);
    const model = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          chapters: [
            { title: "第三章 夜行", summary: "雨夜赶路" },
            { title: "第四章 断桥", summary: "桥头遇袭" }
          ]
        }),
        inputTokens: 200,
        outputTokens: 80
      })
    };
    const handler = createGenerateOutlineHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    expect(txCreate).toHaveBeenCalledTimes(2);
    expect((txCreate.mock.calls[0]![0] as { data: { orderIndex: number } }).data.orderIndex).toBe(3);
    expect((txCreate.mock.calls[1]![0] as { data: { orderIndex: number } }).data.orderIndex).toBe(4);

    const created = txCreate.mock.calls[0]![0] as { data: { parentId: string; level: string; metadata: { source: string } } };
    expect(created.data.parentId).toBe("vol-1");
    expect(created.data.level).toBe("CHAPTER");
    expect(created.data.metadata.source).toBe("GENERATE_OUTLINE");

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        output: expect.objectContaining({ createdCount: 2, requestedCount: 2 })
      })
    );
  });

  it("caps created chapters at the requested count even if the model returns more", async () => {
    const { prisma, txCreate } = makePrisma();
    const model = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          chapters: Array.from({ length: 9 }, (_, i) => ({ title: `第${i + 1}章`, summary: "x" }))
        }),
        inputTokens: 1,
        outputTokens: 1
      })
    };
    const handler = createGenerateOutlineHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob({ input: { chapterCount: 3 } }));

    expect(txCreate).toHaveBeenCalledTimes(3);
  });

  it("fails when the model returns no parseable chapters", async () => {
    const { prisma } = makePrisma();
    const model = {
      generate: vi.fn().mockResolvedValue({ text: "我觉得可以这样写……", inputTokens: 1, outputTokens: 1 })
    };
    const handler = createGenerateOutlineHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "EMPTY_OUTPUT" })
    );
  });

  it("fails when the project is missing", async () => {
    const { prisma } = makePrisma();
    (prisma as unknown as { project: { findFirst: ReturnType<typeof vi.fn> } }).project.findFirst.mockResolvedValue(null);
    const model = { generate: vi.fn() };
    const handler = createGenerateOutlineHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "PROJECT_NOT_FOUND" })
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("rethrows model failures so the poller can retry", async () => {
    const { prisma } = makePrisma();
    const model = { generate: vi.fn().mockRejectedValue(new Error("provider timeout")) };
    const handler = createGenerateOutlineHandler({ prisma, updateJobStatus, model: model as never });

    await expect(handler(makeJob())).rejects.toThrow("provider timeout");
    expect(updateJobStatus).not.toHaveBeenCalled();
  });
});
