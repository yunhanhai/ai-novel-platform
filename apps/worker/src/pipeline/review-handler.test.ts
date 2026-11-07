import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createReviewHandler, verifySuggestions } from "./review-handler";
import type { GenerationJob } from "../poll";

const source = "她推开门，陈年的霉味扑面而来。窗边的人没有回头。";
const job: GenerationJob = { id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1", jobType: "REVIEW", status: "RUNNING", attemptCount: 1, input: { chapterId: "ch-1" }, targetEntityType: "CHAPTER", targetEntityId: "ch-1" };
const issue = { issueType: "style_drift", severity: "warning", quote: "陈年的霉味扑面而来", problem: "可更具体", suggestion: "保留气味信息", replacement: "墙角散出霉味" };
const valid = JSON.stringify({ summary: "一处可优化表达", passed: false, suggestions: [issue] });
const clean = JSON.stringify({ summary: "本次未发现问题", passed: true, suggestions: [] });
function fixture(text = valid, content: string | null = source) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1 }] : [{ id: "ch-1", projectId: "proj-1", content }]),
    generationStep: { update: vi.fn().mockResolvedValue({}) },
    generationJob: { update: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    generationJob: { findFirst: vi.fn().mockResolvedValue({ status: "RUNNING", attemptCount: 1 }) },
    chapter: { findFirst: vi.fn().mockResolvedValue(content === null ? null : { id: "ch-1", title: "合成审校", content }) },
    generationStep: { create: vi.fn().mockResolvedValue({ id: "step-1" }), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn<() => Promise<{ status: string } | null>>().mockResolvedValue(null) },
    usageEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
  };
  const model = { modelName: "synthetic-review", billingSource: "USER_KEY", generate: vi.fn<(...args: unknown[]) => Promise<{ text: string; inputTokens: number; outputTokens: number }>>().mockResolvedValue({ text, inputTokens: 10, outputTokens: 5 }) };
  const updateJobStatus = vi.fn().mockResolvedValue({});
  const handler = createReviewHandler({ prisma: prisma as never, updateJobStatus, model: model as never });
  return { tx, prisma, model, updateJobStatus, handler };
}
function locked(f: ReturnType<typeof fixture>, status = "RUNNING", attemptCount = 1, content: string | null = source) {
  f.tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status, attemptCount }] : [{ id: "ch-1", projectId: "proj-1", content }]);
}

it("only verifies nonempty, unique, verbatim quotes including overlapping duplicates", () => {
  const suggestions = ["霉味", "不存在", "", "哈哈"].map(quote => ({ ...issue, severity: "warning" as const, quote }));
  const result = verifySuggestions("霉味。哈哈哈", suggestions);
  expect(result.map(row => row.verified)).toEqual([true, false, false, false]);
});

it("atomically saves measured validated review with source identity", async () => {
  const f = fixture(); await f.handler(job);
  expect(f.model.generate).toHaveBeenCalledWith(expect.stringContaining(source), expect.objectContaining({ responseFormat: "json_object", maxOutputTokens: expect.any(Number) }));
  expect(f.prisma.generationJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: job.id, organizationId: job.organizationId, projectId: job.projectId, jobType: "REVIEW" }) }));
  expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", output: expect.objectContaining({ chapterId: "ch-1", sourceSha256: createHash("sha256").update(source).digest("hex"), sourceChars: Array.from(source).length, review: expect.objectContaining({ passed: false, degraded: false, verifiedCount: 1, suggestions: [expect.objectContaining({ ...issue, verified: true })] }) }) }) }));
  expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", inputTokens: 10, outputTokens: 5, latencyMs: expect.any(Number) }) }));
  expect(f.updateJobStatus).not.toHaveBeenCalled();
  expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
});
it("keeps nonexisting and repeated quotes for reference but unverified", async () => {
  const f = fixture(JSON.stringify({ summary: "需人工核对", passed: false, suggestions: [{ ...issue, quote: "不存在" }, { ...issue, quote: "她" }] }), "她转身。她走了。");
  await f.handler(job);
  const output = f.tx.generationJob.update.mock.calls[0]?.[0] as any;
  expect(output.data.output.review).toMatchObject({ verifiedCount: 0, unverifiedCount: 2 });
});
it("allows one JSON code fence and preserves explicit passed false with no suggestions", async () => {
  const f = fixture('```json\n' + JSON.stringify({ summary: "仍需人工检查", passed: false, suggestions: [] }) + '\n```'); await f.handler(job);
  const output = f.tx.generationJob.update.mock.calls[0]?.[0] as any;
  expect(output.data.output.review).toMatchObject({ passed: false, suggestions: [], degraded: false });
});
it.each(["散文不是报告", "", "null", "[]", "{}", '{"summary":"ok","passed":"yes","suggestions":[]}', '{"summary":" ","passed":true,"suggestions":[]}', '{"summary":"ok","passed":true,"suggestions":{}}', 'prefix ' + clean, JSON.stringify({ summary: "ok", passed: false, suggestions: [{ ...issue, issueType: "bogus" }] }), JSON.stringify({ summary: "ok", passed: false, suggestions: [{ ...issue, quote: 1 }] }), JSON.stringify({ summary: "ok", passed: false, suggestions: [{ ...issue, suggestion: "" }] }), JSON.stringify({ summary: "ok", passed: false, suggestions: [{ ...issue, replacement: null }] })])("fails invalid output without a fabricated pass: %s", async text => {
  const f = fixture(text); await f.handler(job);
  expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorCode: "INVALID_MODEL_OUTPUT" }) }));
  expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
});
it("includes the chapter ending after the former 12000-character cut", async () => {
  const f = fixture(clean, "前".repeat(12500) + "CHAPTER_END_MARKER"); await f.handler(job);
  expect(f.model.generate.mock.calls[0]?.[0]).toContain("CHAPTER_END_MARKER");
});
it("rejects a source over 20000 Unicode characters without calling a model", async () => {
  const f = fixture(clean, "字".repeat(20001)); await f.handler(job);
  expect(f.model.generate).not.toHaveBeenCalled(); expect(f.prisma.generationStep.create).not.toHaveBeenCalled();
  expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", errorCode: "REVIEW_SOURCE_TOO_LONG", expectedStatus: "RUNNING", expectedAttemptCount: 1 }));
});
it("counts Unicode characters while preserving full emoji input", async () => {
  const content = "😀".repeat(19999) + "尾"; const f = fixture(clean, content); await f.handler(job);
  expect(f.model.generate.mock.calls[0]?.[0]).toContain(content);
  const data = f.tx.generationJob.update.mock.calls[0]?.[0] as any; expect(data.data.output.sourceChars).toBe(20000);
});
it("fails missing or empty chapters before resolving a model", async () => {
  const f = fixture(clean, null); await f.handler(job);
  expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })); expect(f.model.generate).not.toHaveBeenCalled();
});
it("does not allow input chapter to redirect a bound task", async () => {
  const f = fixture(); await f.handler({ ...job, input: { chapterId: "other" } });
  expect(f.model.generate).not.toHaveBeenCalled(); expect(f.prisma.chapter.findFirst).not.toHaveBeenCalled();
  expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_TARGET_MISMATCH" }));
});
it.each(["CANCELLED", "SUCCEEDED", "FAILED"])("does not call a model for preexisting %s task", async status => {
  const f = fixture(); f.prisma.generationJob.findFirst.mockResolvedValue({ status, attemptCount: 1 }); await f.handler(job);
  expect(f.model.generate).not.toHaveBeenCalled(); expect(f.prisma.generationStep.create).not.toHaveBeenCalled();
});
it("does not call a model for an old attempt or wrong handler type", async () => {
  const f = fixture(); f.prisma.generationJob.findFirst.mockResolvedValue({ status: "RUNNING", attemptCount: 2 }); await f.handler(job); await f.handler({ ...job, jobType: "DESLOP" });
  expect(f.model.generate).not.toHaveBeenCalled();
});
it.each(["CANCELLED", "SUCCEEDED", "FAILED"])("does not overwrite an in-flight task that becomes %s", async status => {
  const f = fixture(); locked(f, status); await f.handler(job);
  expect(f.tx.generationJob.update).not.toHaveBeenCalled(); expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED", inputTokens: 10, outputTokens: 5 }) }));
});
it("discards an old in-flight attempt while still recording the response usage", async () => {
  const f = fixture(); locked(f, "RUNNING", 2); await f.handler(job);
  expect(f.tx.generationJob.update).not.toHaveBeenCalled(); expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
});
it("rejects changed source before adopting its report", async () => {
  const f = fixture(); locked(f, "RUNNING", 1, "作者新稿"); await expect(f.handler(job)).rejects.toThrow("正文已变化");
  expect(f.tx.generationJob.update).not.toHaveBeenCalled(); expect(f.prisma.generationStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "RUNNING" }) }));
});
it.each(["SUCCEEDED", "FAILED", "SKIPPED"])("keeps a committed %s final step after transaction acknowledgment is lost", async status => {
  const f = fixture(status === "FAILED" ? "invalid" : valid); if (status === "SKIPPED") locked(f, "CANCELLED");
  const normal = f.prisma.$transaction.getMockImplementation()!;
  f.prisma.$transaction.mockImplementationOnce(async cb => { await normal(cb); f.prisma.generationStep.findFirst.mockResolvedValue({ status }); throw new Error("ack lost"); });
  await expect(f.handler(job)).resolves.toBeUndefined(); expect(f.prisma.generationStep.updateMany).not.toHaveBeenCalled(); expect(f.model.generate).toHaveBeenCalledOnce();
});
it("preserves model error classification when receipt read and cleanup fail", async () => {
  const f = fixture(); const denied = Object.assign(new Error("Unauthorized"), { status: 401 }); f.model.generate.mockRejectedValue(denied); f.prisma.generationStep.findFirst.mockRejectedValue(new Error("receipt unavailable")); f.prisma.generationStep.updateMany.mockRejectedValue(new Error("cleanup unavailable"));
  await expect(f.handler(job)).rejects.toBe(denied); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
});
