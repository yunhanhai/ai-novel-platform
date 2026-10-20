import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRewritePolishHandler } from "./rewrite-polish-handler";
import type { GenerationJob } from "../poll";

const chapterContent = "他推开门，屋里的灰尘扑面而来。\n\n她坐在窗边，头也不抬。";

function makeJob(overrides: Partial<GenerationJob> & { input?: unknown } = {}): GenerationJob {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "proj-1",
    userId: "user-1",
    jobType: "POLISH",
    status: "RUNNING",
    input: { chapterId: "ch-1", selectedText: "她坐在窗边，头也不抬。" },
    ...overrides
  } as GenerationJob;
}

function makePrisma(content: string | null = chapterContent) {
  return {
    chapter: {
      findFirst: vi.fn().mockResolvedValue(
        content ? { id: "ch-1", content } : null
      )
    }
  } as never;
}

describe("createRewritePolishHandler", () => {
  const updateJobStatus = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({});

  beforeEach(() => {
    updateJobStatus.mockClear();
  });

  it("polishes the selection and returns newText via output", async () => {
    const model = { generate: vi.fn().mockResolvedValue({ text: "  她靠在窗边，连眼皮都没抬。  ", inputTokens: 10, outputTokens: 10 }) };
    const handler = createRewritePolishHandler({
      prisma: makePrisma(),
      updateJobStatus,
      model: model as never
    });

    await handler(makeJob());

    expect(model.generate).toHaveBeenCalledOnce();
    const prompt = model.generate.mock.calls[0]![0] as string;
    expect(prompt).toContain("润色");
    expect(prompt).toContain("她坐在窗边，头也不抬。");
    expect(prompt).not.toContain("额外要求");

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "SUCCEEDED",
        output: {
          mode: "POLISH",
          selectedText: "她坐在窗边，头也不抬。",
          newText: "她靠在窗边，连眼皮都没抬。"
        }
      })
    );
  });

  it("rewrites with the rewrite instruction set when jobType is REWRITE", async () => {
    const model = { generate: vi.fn().mockResolvedValue({ text: "门被推开，灰尘迎面涌来。", inputTokens: 5, outputTokens: 5 }) };
    const handler = createRewritePolishHandler({
      prisma: makePrisma(),
      updateJobStatus,
      model: model as never
    });

    await handler(makeJob({ jobType: "REWRITE", input: { chapterId: "ch-1", selectedText: "他推开门，屋里的灰尘扑面而来。" } }));

    const prompt = model.generate.mock.calls[0]![0] as string;
    expect(prompt).toContain("重写");
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        output: expect.objectContaining({ mode: "REWRITE", newText: "门被推开，灰尘迎面涌来。" })
      })
    );
  });

  it("appends the user instruction to the prompt when provided", async () => {
    const model = { generate: vi.fn().mockResolvedValue({ text: "ok", inputTokens: 1, outputTokens: 1 }) };
    const handler = createRewritePolishHandler({
      prisma: makePrisma(),
      updateJobStatus,
      model: model as never
    });

    await handler(makeJob({ input: { chapterId: "ch-1", selectedText: "她坐在窗边，头也不抬。", instruction: "更口语化" } }));

    const prompt = model.generate.mock.calls[0]![0] as string;
    expect(prompt).toContain("额外要求：更口语化");
  });

  it("fails deterministically when selectedText is missing", async () => {
    const model = { generate: vi.fn() };
    const handler = createRewritePolishHandler({
      prisma: makePrisma(),
      updateJobStatus,
      model: model as never
    });

    await handler(makeJob({ input: { chapterId: "ch-1" } }));

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "FAILED",
        errorCode: "SELECTION_MISSING"
      })
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("fails when the chapter does not exist", async () => {
    const model = { generate: vi.fn() };
    const handler = createRewritePolishHandler({
      prisma: makePrisma(null),
      updateJobStatus,
      model: model as never
    });

    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("fails when the selection is no longer part of the chapter content", async () => {
    const model = { generate: vi.fn() };
    const handler = createRewritePolishHandler({
      prisma: makePrisma("章节内容已经完全变了。"),
      updateJobStatus,
      model: model as never
    });

    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "SELECTION_STALE" })
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("resolves chapterId from the job target when input omits it", async () => {
    const model = { generate: vi.fn().mockResolvedValue({ text: "好", inputTokens: 1, outputTokens: 1 }) };
    const handler = createRewritePolishHandler({
      prisma: makePrisma(),
      updateJobStatus,
      model: model as never
    });

    await handler(makeJob({
      targetEntityType: "CHAPTER",
      targetEntityId: "ch-1",
      input: { selectedText: "她坐在窗边，头也不抬。" }
    }));

    expect(model.generate).toHaveBeenCalledOnce();
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCEEDED" })
    );
  });

  it("rethrows model failures so the poller can retry", async () => {
    const model = { generate: vi.fn().mockRejectedValue(new Error("provider timeout")) };
    const handler = createRewritePolishHandler({
      prisma: makePrisma(),
      updateJobStatus,
      model: model as never
    });

    await expect(handler(makeJob())).rejects.toThrow("provider timeout");
    expect(updateJobStatus).not.toHaveBeenCalled();
  });
});
