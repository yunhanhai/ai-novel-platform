import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContinueChapterHandler } from "./continue-chapter-handler";
import type { GenerationJob } from "../poll";

const existingContent = "他推开门，屋里的灰尘扑面而来。\n\n她坐在窗边，头也不抬。";

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "proj-1",
    userId: "user-1",
    jobType: "CONTINUE_CHAPTER",
    status: "RUNNING",
    input: { chapterId: "ch-1" },
    targetEntityType: "CHAPTER",
    targetEntityId: "ch-1",
    ...overrides
  } as GenerationJob;
}

function makePrisma(content: string | null = existingContent) {
  const chapterRow =
    content === null
      ? null
      : { id: "ch-1", projectId: "proj-1", organizationId: "org-1", content, title: "第一章" };
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1, output: null }] : chapterRow ? [chapterRow] : []),
    projectMemory: {updateMany:vi.fn().mockResolvedValue({count:0})},
    chapter: {
      findFirst: vi.fn().mockResolvedValue(chapterRow),
      update: vi.fn().mockResolvedValue({})
    },
    contentVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "v-2", versionNo: 2 })
    },
    generationStep: { create: vi.fn().mockResolvedValue({}) },
    generationJob: { update: vi.fn().mockResolvedValue({}) },
    usageEvent: { create: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    chapter: { findFirst: vi.fn().mockResolvedValue(chapterRow) },
    contentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    generationJob: { findFirst: vi.fn().mockResolvedValue({ status: "RUNNING", attemptCount: 1 }) },
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx))
  };
  return { prisma: prisma as never, tx };
}

describe("createContinueChapterHandler", () => {
  const updateJobStatus = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({});

  beforeEach(() => {
    updateJobStatus.mockClear();
  });

  it("appends the continuation to existing content and persists a new version", async () => {
    const { prisma, tx } = makePrisma();
    const model = { generate: vi.fn().mockResolvedValue({ text: "  她终于开口了。  ", inputTokens: 20, outputTokens: 8 }) };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const prompt = model.generate.mock.calls[0]![0] as string;
    expect(prompt).toContain("继续写");
    expect(prompt).toContain("她坐在窗边，头也不抬。");

    const updated = tx.chapter.update.mock.calls[0]![0] as { data: { content: string } };
    expect(updated.data.content).toBe(`${existingContent}\n\n她终于开口了。`);
    expect(tx.contentVersion.create).toHaveBeenCalled();

    expect(tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "SUCCEEDED", output: expect.objectContaining({ mode: "CONTINUE_CHAPTER", addedChars: 7, targetLength: 600 })
    }) }));
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("starts from scratch when the chapter has no content yet", async () => {
    const { prisma, tx } = makePrisma("");
    const model = { generate: vi.fn().mockResolvedValue({ text: "开头一句。", inputTokens: 1, outputTokens: 5 }) };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const updated = tx.chapter.update.mock.calls[0]![0] as { data: { content: string } };
    expect(updated.data.content).toBe("开头一句。");
  });

  it("strips a markdown code fence from the model output", async () => {
    const { prisma, tx } = makePrisma();
    const model = { generate: vi.fn().mockResolvedValue({ text: "```text\n她开口了。\n```", inputTokens: 1, outputTokens: 5 }) };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const updated = tx.chapter.update.mock.calls[0]![0] as { data: { content: string } };
    expect(updated.data.content).toBe(`${existingContent}\n\n她开口了。`);
  });

  it("only feeds the tail of very long chapters into the prompt", async () => {
    const longContent = `${"前".repeat(3000)}结尾标记`;
    const { prisma } = makePrisma(longContent);
    const model = { generate: vi.fn().mockResolvedValue({ text: "续", inputTokens: 1, outputTokens: 1 }) };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const prompt = model.generate.mock.calls[0]![0] as string;
    expect(prompt).toContain("结尾标记");
    expect(prompt).not.toContain("前".repeat(2000));
  });

  it("clamps an absurd target length", async () => {
    const { prisma } = makePrisma();
    const model = { generate: vi.fn().mockResolvedValue({ text: "续", inputTokens: 1, outputTokens: 1 }) };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob({ input: { chapterId: "ch-1", targetLength: 999999 } }));

    expect(model.generate.mock.calls[0]![0] as string).toContain("3000 字");
  });

  it("fails deterministically when the chapter is missing", async () => {
    const { prisma } = makePrisma(null);
    const model = { generate: vi.fn() };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("fails when the model returns an empty continuation", async () => {
    const { prisma } = makePrisma();
    const model = { generate: vi.fn().mockResolvedValue({ text: "   ```   ", inputTokens: 1, outputTokens: 0 }) };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "EMPTY_OUTPUT" })
    );
  });

  it("rethrows model failures so the poller can retry", async () => {
    const { prisma } = makePrisma();
    const model = { generate: vi.fn().mockRejectedValue(new Error("provider timeout")) };
    const handler = createContinueChapterHandler({ prisma, updateJobStatus, model: model as never });

    await expect(handler(makeJob())).rejects.toThrow("provider timeout");
    expect(updateJobStatus).not.toHaveBeenCalled();
  });
});

it("records actual continuation model latency instead of zero", async () => {
  const { prisma, tx } = makePrisma();
  const clock = vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(1820);
  try {
    await createContinueChapterHandler({ prisma, updateJobStatus: vi.fn(), model: { generate: vi.fn().mockResolvedValue({ text: "续文", inputTokens: 5, outputTokens: 2 }) } })(makeJob());
    expect(tx.usageEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ latencyMs: 820 }) }));
  } finally { clock.mockRestore(); }
});


it("keeps manual edits made while the continuation model is running", async () => {
  const { prisma, tx } = makePrisma();
  const model = { generate: vi.fn().mockImplementation(async () => {
    tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1, output: null }] : [{ id: "ch-1", projectId: "proj-1", content: "人工已修改的新稿" }]);
    return { text: "旧稿续写", inputTokens: 2, outputTokens: 2 };
  }) };
  await expect(createContinueChapterHandler({ prisma, updateJobStatus: vi.fn(), model })(makeJob())).rejects.toThrow("正文已变化");
  expect(tx.chapter.update).not.toHaveBeenCalled();
  expect(tx.contentVersion.create).not.toHaveBeenCalled();
});

it("repairs a saved continuation result without resolving a model or rewriting prose", async () => {
  const { prisma, tx } = makePrisma("人工随后编辑的正文");
  const saved = { id: "saved-version", versionNo: 2, content: "先前保存的续写正文" };
  (prisma as unknown as { contentVersion: { findFirst: ReturnType<typeof vi.fn> } }).contentVersion.findFirst.mockResolvedValue(saved);
  tx.contentVersion.findFirst.mockResolvedValue(saved);
  const resolveModel = vi.fn().mockRejectedValue(new Error("model configuration unavailable"));
  await createContinueChapterHandler({ prisma, updateJobStatus: vi.fn(), resolveModel })(makeJob());
  expect(resolveModel).not.toHaveBeenCalled();
  expect(tx.chapter.update).not.toHaveBeenCalled();
  expect(tx.contentVersion.create).not.toHaveBeenCalled();
  expect(tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", output: expect.objectContaining({ versionId: "saved-version", mode: "CONTINUE_CHAPTER" }) }) }));
});

it("treats a committed version as success even when the transaction response is lost", async () => {
  const { prisma, tx } = makePrisma();
  const db = prisma as unknown as { $transaction: ReturnType<typeof vi.fn>; contentVersion: { findFirst: ReturnType<typeof vi.fn> } };
  const saved = { id: "saved-version", versionNo: 2, content: `${existingContent}续写` };
  const normalTransaction = db.$transaction.getMockImplementation() as (cb: (transaction: unknown) => Promise<unknown>) => Promise<unknown>;
  db.$transaction.mockImplementationOnce(async cb => {
    await normalTransaction(cb);
    db.contentVersion.findFirst.mockResolvedValue(saved);
    tx.contentVersion.findFirst.mockResolvedValue(saved);
    tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "SUCCEEDED", attemptCount: 1, output: { chapterId: "ch-1", versionId: "saved-version" } }] : [{ id: "ch-1", projectId: "proj-1", content: saved.content }]);
    throw new Error("commit acknowledgment lost");
  });
  await expect(createContinueChapterHandler({ prisma, updateJobStatus: vi.fn(), model: { generate: vi.fn().mockResolvedValue({ text: "续写", inputTokens: 1, outputTokens: 1 }) } })(makeJob())).resolves.toBeUndefined();
  expect(tx.contentVersion.create).toHaveBeenCalledOnce();
});
