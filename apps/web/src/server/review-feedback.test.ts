import { describe, expect, it, vi } from "vitest";
import { parseReviewFeedbackProof, recordReviewFeedback } from "./review-feedback";

const id = "11111111-1111-1111-1111-111111111111";
const chapterId = "22222222-2222-2222-2222-222222222222";
const proof = { chapterId, sourceSha256: "a".repeat(64), suggestionIndex: 1, quote: "同一引用", replacement: "第二种改法" };
function fixture() {
  const output = { chapterId, sourceSha256: proof.sourceSha256, sourceChars: 20, custom: { preserved: true }, review: { summary: "摘要", suggestions: [
    { quote: proof.quote, replacement: "第一种改法", verified: true, detail: "first" },
    { quote: proof.quote, replacement: proof.replacement, verified: true, detail: "second" }
  ] } };
  const job = { id, jobType: "REVIEW", status: "SUCCEEDED", targetEntityType: "CHAPTER", targetEntityId: chapterId, output: output as unknown };
  const tx = { $queryRaw: vi.fn().mockResolvedValue([job]), generationJob: { update: vi.fn().mockResolvedValue({}) } };
  const prisma = { $transaction: vi.fn(async (cb: (value: typeof tx) => unknown) => cb(tx)) };
  const run = (override = {}) => recordReviewFeedback({ ...proof, jobId: id, organizationId: "org-1", userId: "user-1", prisma: prisma as never, ...override });
  return { output, job, tx, prisma, run };
}

describe("recordReviewFeedback", () => {
  it("locks the scoped job and only marks the indexed suggestion while preserving the report", async () => {
    const f = fixture(); const before = structuredClone(f.output);
    const result = await f.run();
    expect(f.tx.$queryRaw.mock.calls[0]?.[0].join("")).toMatch(/organization_id.*FOR UPDATE/s);
    expect(result).toMatchObject({ id, chapterId, suggestionIndex: 1, quote: proof.quote, applied: true, appliedAt: expect.any(String), appliedById: "user-1" });
    const write = f.tx.generationJob.update.mock.calls[0]?.[0] as any;
    expect(write.where).toEqual({ id, organizationId: "org-1" });
    expect(write.data.output).toMatchObject({ custom: { preserved: true }, sourceChars: 20, review: { summary: "摘要" } });
    expect(write.data.output.review.suggestions[0]).toEqual(before.review.suggestions[0]);
    expect(write.data.output.review.suggestions[1]).toMatchObject({ ...before.review.suggestions[1], applied: true });
    expect(f.output).toEqual(before);
  });
  it("repeated feedback preserves first actor/time and skips updates", async () => {
    const f = fixture(); Object.assign(f.output.review.suggestions[1]!, { applied: true, appliedAt: "2026-01-01T00:00:00.000Z", appliedById: "first-user" });
    const result = await f.run();
    expect(result).toMatchObject({ appliedAt: "2026-01-01T00:00:00.000Z", appliedById: "first-user" });
    expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it("legacy already-applied marker stays idempotent without inventing provenance", async () => {
    const f = fixture(); Object.assign(f.output.review.suggestions[1]!, { applied: true });
    expect(await f.run()).toMatchObject({ appliedAt: null, appliedById: null });
    expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it("accepts matching uppercase source hash", async () => { const f = fixture(); await f.run({ sourceSha256: proof.sourceSha256.toUpperCase() }); expect(f.tx.generationJob.update).toHaveBeenCalledOnce(); });
  it("returns 404 for another organization without any write", async () => {
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([]); await expect(f.run()).rejects.toMatchObject({ status: 404 }); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it.each([{ status: "RUNNING" }, { status: "FAILED" }, { jobType: "POLISH" }, { targetEntityType: "PROJECT" }, { targetEntityId: id }])("rejects nonmatching final task %j", async value => {
    const f = fixture(); Object.assign(f.job, value); await expect(f.run()).rejects.toMatchObject({ status: 409 }); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { chapterId, sourceSha256: "b".repeat(64), review: { suggestions: [] } }, { chapterId, sourceSha256: proof.sourceSha256, review: null }])("rejects invalid report %j without write", async output => {
    const f = fixture(); f.job.output = output; await expect(f.run()).rejects.toMatchObject({ status: 409 }); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it("returns 404 for a missing index rather than falling back to matching quote", async () => {
    const f = fixture(); await expect(f.run({ suggestionIndex: 2 })).rejects.toMatchObject({ status: 404 }); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it.each([{ quote: "changed" }, { replacement: "changed" }])("rejects proof mismatch %j", async value => {
    const f = fixture(); await expect(f.run(value)).rejects.toMatchObject({ status: 409 }); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it("rejects an unverified suggestion", async () => {
    const f = fixture(); f.output.review.suggestions[1]!.verified = false; await expect(f.run()).rejects.toMatchObject({ status: 409 }); expect(f.tx.generationJob.update).not.toHaveBeenCalled();
  });
  it("rejects invalid helper input before starting a transaction", async () => {
    const f = fixture(); await expect(f.run({ suggestionIndex: -1 })).rejects.toMatchObject({ status: 400 }); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("preserves an intentional whitespace-only replacement verbatim", () => { expect(parseReviewFeedbackProof({ ...proof, replacement: " " })?.replacement).toBe(" "); });
  it.each([null, [], {}, { ...proof, suggestionIndex: Number.MAX_SAFE_INTEGER + 1 }, { ...proof, quote: " " }, { ...proof, replacement: "" }])("validates incoming proof %j", value => { expect(parseReviewFeedbackProof(value)).toBeNull(); });
});
