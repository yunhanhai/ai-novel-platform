import { describe, expect, it, vi } from "vitest";
import { createRewritePolishHandler } from "./rewrite-polish-handler";
import type { GenerationJob } from "../poll";
function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return { id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1", jobType: "POLISH", status: "RUNNING", input: {}, ...overrides };
}
function guardedFixture() {
  const content = "她坐在窗边。";
  const current = { status: "RUNNING", attemptCount: 1 };
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [current] : [{ content }]),
    generationStep: { update: vi.fn().mockResolvedValue({}) }, generationJob: { update: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    chapter: { findFirst: vi.fn().mockResolvedValue({ id: "ch-1", content }) },
    generationJob: { findFirst: vi.fn().mockResolvedValue(current) },
    generationStep: { create: vi.fn().mockResolvedValue({ id: "step-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn<() => Promise<{ status: string } | null>>().mockResolvedValue(null) },
    usageEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
  };
  const model = { modelName: "fixture", billingSource: "USER_KEY" as const, generate: vi.fn().mockResolvedValue({ text: "她倚在窗畔。", inputTokens: 12, outputTokens: 6 }) };
  const job = makeJob({ attemptCount: 1, input: { selectedText: content }, targetEntityType: "CHAPTER", targetEntityId: "ch-1" });
  const update = vi.fn().mockResolvedValue({});
  const handler = createRewritePolishHandler({ prisma: prisma as never, updateJobStatus: update, model });
  return { content, current, tx, prisma, model, job, update, handler };
}

describe("rewrite candidate integrity", () => {
  it.each(["CANCELLED", "SUCCEEDED", "FAILED"])("does not resolve a model or start a completed %s job", async status => {
    const f = guardedFixture(); f.current.status = status;
    await f.handler(f.job); expect(f.model.generate).not.toHaveBeenCalled(); expect(f.prisma.generationStep.create).not.toHaveBeenCalled();
  });
  it("discards an old attempt before calling a model", async () => {
    const f = guardedFixture(); f.current.attemptCount = 2;
    await f.handler(f.job); expect(f.model.generate).not.toHaveBeenCalled();
  });
  it.each(["CANCELLED", "SUCCEEDED", "NEW_ATTEMPT"])("does not overwrite an in-flight %s result", async status => {
    const f = guardedFixture(); f.model.generate.mockImplementation(async () => { if (status === "NEW_ATTEMPT") f.current.attemptCount = 2; else f.current.status = status; return { text: "候选", inputTokens: 12, outputTokens: 6 }; });
    await f.handler(f.job);
    expect(f.tx.generationJob.update).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED" }) }));
    expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
  });
  it("rejects source changes rather than storing a stale candidate", async () => {
    const f = guardedFixture(); f.tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [f.current] : [{ content: "作者新稿" }]);
    await expect(f.handler(f.job)).rejects.toThrow("正文已变化"); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it("meters blank returned output and finalizes failure atomically", async () => {
    const f = guardedFixture(); f.model.generate.mockResolvedValue({ text: "  ", inputTokens: 12, outputTokens: 6 });
    await f.handler(f.job); expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
    expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorCode: "EMPTY_OUTPUT" }) }));
    expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });
  it("keeps a committed candidate when acknowledgment is lost", async () => {
    const f = guardedFixture(); const normal = f.prisma.$transaction.getMockImplementation()!;
    f.prisma.$transaction.mockImplementationOnce(async cb => { await normal(cb); f.prisma.generationStep.findFirst.mockResolvedValue({ status: "SUCCEEDED" }); throw new Error("commit ack lost"); });
    await expect(f.handler(f.job)).resolves.toBeUndefined(); expect(f.prisma.generationStep.updateMany).not.toHaveBeenCalled(); expect(f.model.generate).toHaveBeenCalledOnce();
  });
  it("preserves provider classification when cleanup and receipt reads fail", async () => {
    const f = guardedFixture(); const denied = Object.assign(new Error("Unauthorized"), { status: 401 });
    f.model.generate.mockRejectedValue(denied); f.prisma.generationStep.findFirst.mockRejectedValue(new Error("receipt unavailable")); f.prisma.generationStep.updateMany.mockRejectedValue(new Error("cleanup unavailable"));
    await expect(f.handler(f.job)).rejects.toBe(denied); expect(f.prisma.usageEvent.create).not.toHaveBeenCalled();
  });
});

describe("rewrite and polish existing contract", () => {
  it("returns trimmed polish text with measured steps and source receipt", async () => {
    const f = guardedFixture(); f.model.generate.mockResolvedValue({ text: "  她倚在窗畔。  ", inputTokens: 12, outputTokens: 6 });
    await f.handler(f.job);
    expect(f.model.generate).toHaveBeenCalledWith(expect.stringContaining("润色"));
    expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", output: expect.objectContaining({ mode: "POLISH", selectedText: f.content, newText: "她倚在窗畔。", chapterId: "ch-1", sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) }) }));
    expect(f.prisma.generationStep.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RUNNING", stepKey: "polish_selection" }) }));
    expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", latencyMs: expect.any(Number), inputTokens: 12, outputTokens: 6 }) }));
  });
  it("uses the rewrite prompt and additional instruction", async () => {
    const f = guardedFixture();
    await f.handler({ ...f.job, jobType: "REWRITE", input: { selectedText: f.content, instruction: "更口语化" } });
    expect(f.model.generate).toHaveBeenCalledWith(expect.stringContaining("重写"));
    expect(f.model.generate).toHaveBeenCalledWith(expect.stringContaining("额外要求：更口语化"));
    expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ output: expect.objectContaining({ mode: "REWRITE" }) }) }));
  });
  it("fails a missing selection before resolving a model", async () => {
    const f = guardedFixture(); const resolveModel = vi.fn();
    await createRewritePolishHandler({ prisma: f.prisma as never, updateJobStatus: f.update, resolveModel })({ ...f.job, input: {} });
    expect(resolveModel).not.toHaveBeenCalled();
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "SELECTION_MISSING", expectedStatus: "RUNNING", expectedAttemptCount: 1 }));
  });
  it("fails a missing chapter without calling a model", async () => {
    const f = guardedFixture(); f.prisma.chapter.findFirst.mockResolvedValue(null as never);
    await f.handler(f.job); expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "CHAPTER_NOT_FOUND" })); expect(f.model.generate).not.toHaveBeenCalled();
  });
  it("rejects a stale selection before a model call", async () => {
    const f = guardedFixture(); await f.handler({ ...f.job, input: { selectedText: "不在正文的选文" } });
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "SELECTION_STALE" })); expect(f.model.generate).not.toHaveBeenCalled();
  });
  it("honors the scoped target chapter over an input chapter", async () => {
    const f = guardedFixture(); await f.handler({ ...f.job, input: { selectedText: f.content, chapterId: "other-chapter" } });
    expect(f.prisma.chapter.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "ch-1", organizationId: "org-1", projectId: "proj-1" }) }));
  });
  it("uses the input chapter when there is no chapter target", async () => {
    const f = guardedFixture(); await f.handler({ ...f.job, targetEntityType: null, targetEntityId: null, input: { selectedText: f.content, chapterId: "input-chapter" } });
    expect(f.prisma.chapter.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "input-chapter" }) }));
  });
  it("does not replace a successful candidate when metering fails", async () => {
    const f = guardedFixture(); f.prisma.usageEvent.create.mockRejectedValue(new Error("meter unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try { await f.handler(f.job); expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) })); }
    finally { warn.mockRestore(); }
  });
});
