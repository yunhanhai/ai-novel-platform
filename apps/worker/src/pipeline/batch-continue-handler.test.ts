import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBatchContinueHandler, normalizeChapterCount } from "./batch-continue-handler";
import type { GenerationJob } from "../poll";

const initialContent = "他推开门，屋里的灰尘扑面而来。";

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "proj-1",
    userId: "user-1",
    jobType: "BATCH_CONTINUE",
    status: "RUNNING",
    input: { chapterId: "ch-1", chapterCount: 2 },
    targetEntityType: "CHAPTER",
    targetEntityId: "ch-1",
    ...overrides
  } as GenerationJob;
}

function makePrisma(contentAtCall: () => string) {
  let call = 0;
  const findFirstImpl = () => {
    call += 1;
    // 第一次是存在性预检（chapter0），之后每章前重读；commitFinalize 的事务里也会调用
    return Promise.resolve(
      call === 1
        ? { id: "ch-1", projectId: "proj-1", organizationId: "org-1", title: "第一章" }
        : { id: "ch-1", projectId: "proj-1", organizationId: "org-1", title: "第一章", chapterNo: 1, content: contentAtCall() }
    );
  };
  const tx = {
    chapter: { findFirst: vi.fn().mockImplementation(findFirstImpl), update: vi.fn().mockResolvedValue({}) },
    contentVersion: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "v-1", versionNo: 1 }) },
    generationStep: { create: vi.fn().mockResolvedValue({}) },
    generationJob: { update: vi.fn().mockResolvedValue({}) },
    usageEvent: { create: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    chapter: {
      findFirst: vi.fn().mockImplementation(findFirstImpl)
    },
    contentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    generationJob: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx))
  };
  return { prisma: prisma as never, tx, contentCalls: () => call };
}

describe("normalizeChapterCount", () => {
  it("defaults to 1 and clamps to 10", () => {
    expect(normalizeChapterCount(undefined)).toBe(1);
    expect(normalizeChapterCount("3")).toBe(3);
    expect(normalizeChapterCount(0)).toBe(1);
    expect(normalizeChapterCount(99)).toBe(10);
    expect(normalizeChapterCount(-1)).toBe(1);
  });
});

describe("createBatchContinueHandler", () => {
  const updateJobStatus = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({});

  beforeEach(() => {
    updateJobStatus.mockClear();
  });

  it("continues the requested number of chapters and reports progress", async () => {
    let appended = "";
    const { prisma } = makePrisma(() => `${initialContent}${appended}`);
    const model = {
      generate: vi.fn().mockImplementation(() => {
        appended += "【新段落】";
        return Promise.resolve({ text: "【新段落】", inputTokens: 10, outputTokens: 5 });
      })
    };

    const handler = createBatchContinueHandler({ prisma, updateJobStatus, model: model as never });
    await handler(makeJob({ input: { chapterId: "ch-1", chapterCount: 3 } }));

    expect(model.generate).toHaveBeenCalledTimes(3);
    // 每章都重读了章节内容（第一次是存在性预检）
    expect(appended).toBe("【新段落】【新段落】【新段落】");

    const success = updateJobStatus.mock.calls.at(-1)![0] as {
      status: string;
      output: { completedChapters: number; addedChars: number };
    };
    expect(success.status).toBe("SUCCEEDED");
    expect(success.output.completedChapters).toBe(3);
    expect(success.output.addedChars).toBeGreaterThan(0);
  });

  it("keeps completed chapters when a later round returns empty", async () => {
    let round = 0;
    const { prisma } = makePrisma(() => `${initialContent}${"段".repeat(round * 10)}`);
    const model = {
      generate: vi.fn().mockImplementation(() => {
        round += 1;
        return Promise.resolve(
          round === 1
            ? { text: "第一段续写", inputTokens: 5, outputTokens: 3 }
            : { text: "   ", inputTokens: 1, outputTokens: 0 }
        );
      })
    };

    const handler = createBatchContinueHandler({ prisma, updateJobStatus, model: model as never });
    await handler(makeJob({ input: { chapterId: "ch-1", chapterCount: 3 } }));

    const failure = updateJobStatus.mock.calls.at(-1)![0] as {
      status: string;
      errorCode: string;
      errorMessage: string;
    };
    expect(failure.status).toBe("FAILED");
    expect(failure.errorCode).toBe("BATCH_ABORTED");
    expect(failure.errorMessage).toContain("已完成 1 章");
  });

  it("fails when the chapter is missing", async () => {
    const prisma = {
      chapter: { findFirst: vi.fn().mockResolvedValue(null) },
      contentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn()
    } as never;
    const model = { generate: vi.fn() };

    const handler = createBatchContinueHandler({ prisma, updateJobStatus, model: model as never });
    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("resolves chapterId from the job target when input omits it", async () => {
    const { prisma, contentCalls } = makePrisma(() => initialContent);
    const model = { generate: vi.fn().mockResolvedValue({ text: "续", inputTokens: 1, outputTokens: 1 }) };

    const handler = createBatchContinueHandler({ prisma, updateJobStatus, model: model as never });
    await handler(makeJob({ input: { chapterCount: 1 }, targetEntityId: "ch-1" }));

    expect(model.generate).toHaveBeenCalledOnce();
    expect(contentCalls()).toBeGreaterThanOrEqual(2);
  });

  it("extracts memories after every chapter by default", async () => {
    let appended = "";
    const { prisma } = makePrisma(() => `${initialContent}${appended}`);
    const model = {
      generate: vi.fn().mockImplementation(() => {
        appended += "新段落";
        return Promise.resolve({ text: "新段落", inputTokens: 1, outputTokens: 1 });
      })
    };
    const extractMemories = vi.fn().mockResolvedValue({});

    const handler = createBatchContinueHandler({
      prisma, updateJobStatus, model: model as never, extractMemories
    });
    await handler(makeJob({ input: { chapterId: "ch-1", chapterCount: 2 } }));

    expect(extractMemories).toHaveBeenCalledTimes(2);
    // 抽取拿到的是落库后的最新正文
    const firstCallChapter = (extractMemories.mock.calls[0]![0] as { chapter: { content: string; chapterNo: number } }).chapter;
    expect(firstCallChapter.content).toContain("新段落");
    expect(firstCallChapter.chapterNo).toBe(1);

    const success = updateJobStatus.mock.calls.at(-1)![0] as { output: { memoryExtractedChapters: number } };
    expect(success.output.memoryExtractedChapters).toBe(2);
  });

  it("keeps continuing when memory extraction fails", async () => {
    const { prisma } = makePrisma(() => initialContent);
    const model = { generate: vi.fn().mockResolvedValue({ text: "新段落", inputTokens: 1, outputTokens: 1 }) };
    const extractMemories = vi.fn().mockRejectedValue(new Error("memory model down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const handler = createBatchContinueHandler({
      prisma, updateJobStatus, model: model as never, extractMemories
    });
    await handler(makeJob({ input: { chapterId: "ch-1", chapterCount: 2 } }));

    expect(model.generate).toHaveBeenCalledTimes(2);
    const success = updateJobStatus.mock.calls.at(-1)![0] as {
      status: string;
      output: { completedChapters: number; memoryExtractedChapters: number };
    };
    expect(success.status).toBe("SUCCEEDED");
    expect(success.output.completedChapters).toBe(2);
    expect(success.output.memoryExtractedChapters).toBe(0);
    warn.mockRestore();
  });

  it("skips extraction when the caller opts out", async () => {
    const { prisma } = makePrisma(() => initialContent);
    const model = { generate: vi.fn().mockResolvedValue({ text: "新段落", inputTokens: 1, outputTokens: 1 }) };
    const extractMemories = vi.fn().mockResolvedValue({});

    const handler = createBatchContinueHandler({
      prisma, updateJobStatus, model: model as never, extractMemories
    });
    await handler(makeJob({ input: { chapterId: "ch-1", chapterCount: 2, extractMemory: false } }));

    expect(extractMemories).not.toHaveBeenCalled();
  });
});
