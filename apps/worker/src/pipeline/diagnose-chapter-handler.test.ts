import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createDiagnoseChapterHandler, type DiagnosticType } from "./diagnose-chapter-handler";
import type { GenerationJob } from "../poll";

const source = "她推开门，陈年的霉味扑面而来。窗边的人没有回头。";
const job: GenerationJob = { id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1", jobType: "DIAGNOSE_CHAPTER", status: "RUNNING", attemptCount: 1, input: { chapterId: "ch-1" }, targetEntityType: "CHAPTER", targetEntityId: "ch-1" };
const report = { readerScore: 82, abandonRisk: "low", hookStrength: 70, pacingScore: 75, styleDrift: 10, continuityIssues: [{ severity: "warning", detail: "时间线需核对", suggestion: "补一句过渡" }], suggestions: ["增强结尾钩子"] };
const valid = JSON.stringify(report);
function fixture(text = valid, content: string | null = source, type: DiagnosticType = "DIAGNOSE_CHAPTER") {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1 }] : [{ id: "ch-1", projectId: "proj-1", content }]),
    generationStep: { update: vi.fn().mockResolvedValue({}) },
    generationJob: { update: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    generationJob: { findFirst: vi.fn().mockResolvedValue({ status: "RUNNING", attemptCount: 1 }) },
    chapter: { findFirst: vi.fn().mockResolvedValue(content === null ? null : { id: "ch-1", title: "合成诊断", outlineSummary: "核验日期", content, project: { title: "雨夜", styleBrief: "克制", premise: "明天的自己寄来死亡预告，保安为保住工作隐瞒证据。" } }) },
    generationStep: { create: vi.fn().mockResolvedValue({ id: "step-1" }), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn<() => Promise<{ status: string } | null>>().mockResolvedValue(null) },
    usageEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
  };
  const model = { modelName: "synthetic-diagnostic", billingSource: "USER_KEY", generate: vi.fn<(...args: unknown[]) => Promise<{ text: string; inputTokens: number; outputTokens: number }>>().mockResolvedValue({ text, inputTokens: 10, outputTokens: 5 }) };
  const updateJobStatus = vi.fn().mockResolvedValue({});
  const handler = createDiagnoseChapterHandler({ prisma: prisma as never, updateJobStatus, model: model as never, diagnosticType: type });
  return { tx, prisma, model, updateJobStatus, handler };
}
function locked(f: ReturnType<typeof fixture>, status = "RUNNING", attemptCount = 1, content: string | null = source) {
  f.tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status, attemptCount }] : [{ id: "ch-1", projectId: "proj-1", content }]);
}

it.each(["DIAGNOSE_CHAPTER", "READER_SIMULATION", "STYLE_DRIFT_CHECK", "CONTINUITY_CHECK"] as const)("atomically saves measured complete-source %s diagnosis", async type => {
  const f = fixture(valid, source, type); await f.handler({ ...job, jobType: type });
  expect(f.model.generate).toHaveBeenCalledWith(expect.stringContaining(source), expect.objectContaining({ responseFormat: "json_object", maxOutputTokens: expect.any(Number) }));
  expect(f.prisma.generationJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: job.id, organizationId: job.organizationId, projectId: job.projectId, jobType: type }) }));
  expect(f.tx.$queryRaw.mock.calls.at(-1)).toContain(type.toLowerCase());
  expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", output: expect.objectContaining({ chapterId: "ch-1", diagnosticType: type, sourceSha256: createHash("sha256").update(source).digest("hex"), sourceChars: Array.from(source).length, diagnosticSummary: report, performanceSummary: expect.objectContaining({ modelCalls: 1, inputTokens: 10, outputTokens: 5 }) }) }) }));
  expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", inputTokens: 10, outputTokens: 5, latencyMs: expect.any(Number) }) }));
  expect(f.updateJobStatus).not.toHaveBeenCalled(); expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
});
it("uses stored premise, outline, style and score-direction/evidence scope in prompt", async () => {
  const f = fixture(); await f.handler(job); const prompt = f.model.generate.mock.calls[0]?.[0] as string;
  expect(prompt).toContain("明天的自己寄来死亡预告"); expect(prompt).toContain("核验日期"); expect(prompt).toContain("克制");
  expect(prompt).toContain("0=无漂移"); expect(prompt).toContain("未写出的事件"); expect(prompt).toContain("参考");
});
it("allows a single JSON code fence and valid zero/boundary scores", async () => {
  const summary = { ...report, readerScore: 0, styleDrift: 100, continuityIssues: [], suggestions: [] };
  const f = fixture('```json\n' + JSON.stringify(summary) + '\n```'); await f.handler(job);
  expect((f.tx.generationJob.update.mock.calls[0]?.[0] as any).data.output.diagnosticSummary).toEqual(summary);
});
it.each(["散文不是报告", "", "null", "[]", "{}", 'prefix ' + valid, JSON.stringify({ ...report, readerScore: 101 }), JSON.stringify({ ...report, hookStrength: -1 }), JSON.stringify({ ...report, pacingScore: 12.5 }), JSON.stringify({ ...report, styleDrift: "10" }), JSON.stringify({ ...report, abandonRisk: "nonsense" }), JSON.stringify({ ...report, abandonRisk: ["low"] }), JSON.stringify({ ...report, continuityIssues: [{ severity: ["warning"], detail: "x", suggestion: "y" }] }), JSON.stringify({ ...report, suggestions: {} }), JSON.stringify({ ...report, suggestions: [""] }), JSON.stringify({ ...report, continuityIssues: [null] }), JSON.stringify({ ...report, continuityIssues: [{ severity: "bogus", detail: "x", suggestion: "y" }] }), JSON.stringify({ ...report, continuityIssues: [{ severity: "warning", detail: " ", suggestion: "y" }] }), JSON.stringify({ ...report, continuityIssues: [{ severity: "warning", detail: "x", suggestion: "" }] })])("fails invalid output without invented numeric scores: %s", async text => {
  const f = fixture(text); await f.handler(job);
  expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorCode: "INVALID_MODEL_OUTPUT", errorMessage: expect.stringContaining("诊断 JSON") }) }));
  expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
});
it("includes the chapter ending after the former 8000-character cut", async () => {
  const f = fixture(valid, "前".repeat(8500) + "CHAPTER_END_MARKER"); await f.handler(job); expect(f.model.generate.mock.calls[0]?.[0]).toContain("CHAPTER_END_MARKER");
});
it("rejects more than20000Unicode characters before model resolution or step creation", async () => {
  const f = fixture(valid, "字".repeat(20001)); const resolveModel = vi.fn();
  await createDiagnoseChapterHandler({ prisma: f.prisma as never, updateJobStatus: f.updateJobStatus, resolveModel })(job);
  expect(resolveModel).not.toHaveBeenCalled(); expect(f.prisma.generationStep.create).not.toHaveBeenCalled();
  expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", errorCode: "DIAGNOSTIC_SOURCE_TOO_LONG", expectedStatus: "RUNNING", expectedAttemptCount: 1 }));
});
it("counts Unicode characters while preserving full emoji input", async () => {
  const content = "😀".repeat(19999) + "尾"; const f = fixture(valid, content); await f.handler(job);
  expect(f.model.generate.mock.calls[0]?.[0]).toContain(content); expect((f.tx.generationJob.update.mock.calls[0]?.[0] as any).data.output.sourceChars).toBe(20000);
});
it.each([null, "", " "])("rejects missing or blank chapter %j", async content => {
  const f = fixture(valid, content); await f.handler(job); expect(f.model.generate).not.toHaveBeenCalled();
  expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "CHAPTER_NOT_FOUND", expectedStatus: "RUNNING", expectedAttemptCount: 1 }));
});
it("rejects a conflicting input chapter without resolving a model", async () => {
  const f = fixture(); await f.handler({ ...job, input: { chapterId: "other" } }); expect(f.model.generate).not.toHaveBeenCalled(); expect(f.prisma.chapter.findFirst).not.toHaveBeenCalled();
  expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "CHAPTER_TARGET_MISMATCH" }));
});
it.each(["CANCELLED", "SUCCEEDED", "FAILED"])("does not call a model for preexisting %s", async status => {
  const f = fixture(); f.prisma.generationJob.findFirst.mockResolvedValue({ status, attemptCount: 1 }); await f.handler(job); expect(f.model.generate).not.toHaveBeenCalled();
});
it("does not call a model for an old attempt or wrong factory type", async () => {
  const f = fixture(); f.prisma.generationJob.findFirst.mockResolvedValue({ status: "RUNNING", attemptCount: 2 }); await f.handler(job); await f.handler({ ...job, jobType: "STYLE_DRIFT_CHECK" }); expect(f.model.generate).not.toHaveBeenCalled();
});
it.each(["CANCELLED", "SUCCEEDED", "FAILED"])("discards a response after task becomes %s", async status => {
  const f = fixture(); locked(f, status); await f.handler(job); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED", inputTokens: 10, outputTokens: 5 }) }));
});
it("discards old attempt response but records its usage", async () => {
  const f = fixture(); locked(f, "RUNNING", 2); await f.handler(job); expect(f.tx.generationJob.update).not.toHaveBeenCalled(); expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
});
it("rejects a changed locked source without adopting scores", async () => {
  const f = fixture(); locked(f, "RUNNING", 1, "作者新稿"); await expect(f.handler(job)).rejects.toThrow("正文已变化"); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  expect(f.prisma.generationStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "RUNNING" }) }));
});
it.each(["SUCCEEDED", "FAILED", "SKIPPED"])("recovers a committed %s step when transaction acknowledgment is lost", async status => {
  const f = fixture(status === "FAILED" ? "invalid" : valid); if (status === "SKIPPED") locked(f, "CANCELLED");
  const normal = f.prisma.$transaction.getMockImplementation()!;
  f.prisma.$transaction.mockImplementationOnce(async cb => { await normal(cb); f.prisma.generationStep.findFirst.mockResolvedValue({ status }); throw new Error("ack lost"); });
  await expect(f.handler(job)).resolves.toBeUndefined(); expect(f.prisma.generationStep.updateMany).not.toHaveBeenCalled(); expect(f.model.generate).toHaveBeenCalledOnce();
});
it("fails missing model profile with attempt and terminal guards", async () => {
  const f = fixture(); await createDiagnoseChapterHandler({ prisma: f.prisma as never, updateJobStatus: f.updateJobStatus, resolveModel: async () => null })(job);
  expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "NO_MODEL_PROFILE", expectedStatus: "RUNNING", expectedAttemptCount: 1 }));
});
it("keeps original model error if receipt read and cleanup fail", async () => {
  const f = fixture(); const denied = Object.assign(new Error("Unauthorized"), { status: 401 }); f.model.generate.mockRejectedValue(denied); f.prisma.generationStep.findFirst.mockRejectedValue(new Error("receipt unavailable")); f.prisma.generationStep.updateMany.mockRejectedValue(new Error("cleanup unavailable"));
  await expect(f.handler(job)).rejects.toBe(denied); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
});
