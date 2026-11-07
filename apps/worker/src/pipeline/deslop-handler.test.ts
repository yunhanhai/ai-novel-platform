import { describe, expect, it, vi } from "vitest";
import { createDeslopHandler } from "./deslop-handler";
import type { GenerationJob } from "../poll";
const job: GenerationJob = { id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1", jobType: "DESLOP", status: "RUNNING", attemptCount: 1, input: {}, targetEntityType: "CHAPTER", targetEntityId: "chapter-1" };
const valid = JSON.stringify({ issues: [{ category: "stock_phrase", severity: "warning", matched: "仿佛", suggestion: "改为具体动作", position: { start: 0, end: 0 } }], overallScore: 80, summary: "一处可核对表达" });
function fixture(text = valid, content: string | null = "她仿佛听见门响。") {
  const step = { id: "step-1" };
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1 }] : [{ id: "chapter-1", projectId: "proj-1", content }]),
    generationStep: { update: vi.fn().mockResolvedValue({}) }, generationJob: { update: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    generationJob: { findFirst: vi.fn().mockResolvedValue({ status: "RUNNING", attemptCount: 1 }) },
    chapter: { findFirst: vi.fn().mockResolvedValue(content === null ? null : { id: "chapter-1", title: "合成", content }) },
    generationStep: { create: vi.fn().mockResolvedValue(step), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn<() => Promise<{ status: string } | null>>().mockResolvedValue(null) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
  };
  const model = { generate: vi.fn<(...args: unknown[]) => Promise<{ text: string; inputTokens: number; outputTokens: number }>>().mockResolvedValue({ text, inputTokens: 10, outputTokens: 5 }) };
  const updateJobStatus = vi.fn().mockResolvedValue({});
  const handler = createDeslopHandler({ prisma: prisma as never, updateJobStatus, model });
  return { tx, prisma, model, updateJobStatus, handler };
}
describe("deslop handler report integrity", () => {
  it("saves the full validated report and measured step with JSON options", async () => {
    const f = fixture(); await f.handler(job);
    expect(f.model.generate).toHaveBeenCalledWith(expect.any(String), { responseFormat: "json_object" });
    expect(f.prisma.generationStep.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RUNNING" }) }));
    expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", output: expect.objectContaining({ issueCount: 1, deslopReport: expect.objectContaining({ issues: [expect.objectContaining({ matched: "仿佛", position: { start: 1, end: 3 } })], sourceChars: 8 }) }) }) }));
    expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", latencyMs: expect.any(Number) }) }));
  });
  it("fails empty/missing body before a model call", async () => {
    const f = fixture(valid, null); await f.handler(job);
    expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" }));
    expect(f.model.generate).not.toHaveBeenCalled();
  });
  it("does not fabricate a perfect score for invalid model output", async () => {
    const f = fixture("散文不是报告"); await f.handler(job);
    expect(f.tx.generationJob.update).not.toHaveBeenCalled();
    expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", errorCode: "INVALID_MODEL_OUTPUT", expectedStatus: "RUNNING", expectedAttemptCount: 1 }));
    expect(f.prisma.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });
  it("sends the ending beyond the former 8000-character cut", async () => {
    const f = fixture(JSON.stringify({ issues: [], overallScore: 70, summary: "合成摘要" }), "前".repeat(8500) + "CHAPTER_END_MARKER");
    await f.handler(job); expect(f.model.generate.mock.calls[0]?.[0]).toContain("CHAPTER_END_MARKER");
  });
  it("rejects above 20000 Unicode characters before a model call", async () => {
    const f = fixture(valid, "字".repeat(20001)); await f.handler(job);
    expect(f.model.generate).not.toHaveBeenCalled();
    expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "DESLOP_SOURCE_TOO_LONG" }));
  });
  it("counts emoji by Unicode characters while keeping original quote offsets", async () => {
    const f = fixture(JSON.stringify({ issues: [], overallScore: 70, summary: "合成摘要" }), "😀".repeat(19999) + "尾");
    await f.handler(job); expect(f.model.generate).toHaveBeenCalledOnce();
  });
  it("rejects stale source reports without saving them", async () => {
    const f = fixture(); f.tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1 }] : [{ id: "chapter-1", projectId: "proj-1", content: "已经改变" }]);
    await expect(f.handler(job)).rejects.toThrow("正文已变化");
    expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it.each(["CANCELLED", "SUCCEEDED"])("discards the in-flight report when job status becomes %s", async status => {
    const f = fixture(); f.tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status, attemptCount: 1 }] : [{ content: "她仿佛听见门响。" }]);
    await f.handler(job); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
    expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED" }) }));
  });
  it("preserves the original authentication error even if step cleanup fails", async () => {
    const f = fixture(); const denied = Object.assign(new Error("Unauthorized"), { status: 401 });
    f.model.generate.mockRejectedValue(denied); f.prisma.generationStep.findFirst.mockRejectedValue(new Error("receipt read failed")); f.prisma.generationStep.updateMany.mockRejectedValue(new Error("cleanup failed"));
    await expect(f.handler(job)).rejects.toBe(denied);
  });
});

it("keeps a committed report successful when its transaction acknowledgment is lost", async () => {
  const f = fixture();
  const normalTransaction = f.prisma.$transaction.getMockImplementation()!;
  f.prisma.$transaction.mockImplementationOnce(async cb => {
    await normalTransaction(cb);
    f.prisma.generationStep.findFirst.mockResolvedValue({ status: "SUCCEEDED" });
    throw new Error("commit ack lost");
  });
  await expect(f.handler(job)).resolves.toBeUndefined();
  expect(f.tx.generationJob.update).toHaveBeenCalledOnce();
  expect(f.prisma.generationStep.updateMany).not.toHaveBeenCalled();
});
