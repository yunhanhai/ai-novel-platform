import { describe, expect, it, vi } from "vitest";
import { buildOutlinePrompt, createGenerateOutlineHandler, normalizeChapterCount, normalizeDraftedChapters } from "./generate-outline-handler";
import type { GenerationJob } from "../poll";

const project = { id: "proj-1", title: "长夜", premise: "少年入京", genre: "悬疑", styleBrief: "克制" };
const node = { id: "vol-1", parentId: null, level: "VOLUME", title: "第一卷", summary: "源摘要", orderIndex: 1, status: "PLANNED", targetChapterId: null, updatedAt: new Date("2026-01-01") };
const job: GenerationJob = { id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1", jobType: "GENERATE_OUTLINE", status: "RUNNING", attemptCount: 1, targetEntityType: "PROJECT", targetEntityId: "proj-1", input: { chapterCount: 2 } };
const chapters = [{ title: "夜行", summary: "雨夜赶路" }, { title: "断桥", summary: "桥头遇袭" }];
const valid = JSON.stringify({ chapters });
function fixture(text = valid) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1 }] : [project]),
    outline: { findMany: vi.fn().mockResolvedValue([node]), create: vi.fn().mockImplementation(async (args: any) => ({ id: `created-${args.data.orderIndex}`, title: args.data.title, orderIndex: args.data.orderIndex })) },
    generationStep: { update: vi.fn().mockResolvedValue({}) }, generationJob: { update: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue(project) },
    outline: { findMany: vi.fn().mockResolvedValue([node]), findFirst: vi.fn().mockResolvedValue(node) },
    character: { findMany: vi.fn().mockResolvedValue([{ name: "林墨" }]) }, worldItem: { findMany: vi.fn().mockResolvedValue([{ name: "枯槐" }]) },
    generationJob: { findFirst: vi.fn().mockResolvedValue({ status: "RUNNING", attemptCount: 1 }) },
    generationStep: { create: vi.fn().mockResolvedValue({ id: "step-1" }), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn<() => Promise<{ status: string } | null>>().mockResolvedValue(null) },
    usageEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx))
  };
  const model = { modelName: "synthetic-outline", billingSource: "USER_KEY", generate: vi.fn<(...args: unknown[]) => Promise<{ text: string; inputTokens: number; outputTokens: number }>>().mockResolvedValue({ text, inputTokens: 12, outputTokens: 8 }) };
  const updateJobStatus = vi.fn().mockResolvedValue({});
  return { tx, prisma, model, updateJobStatus, handler: createGenerateOutlineHandler({ prisma: prisma as never, updateJobStatus, model: model as never }) };
}
function locked(f: ReturnType<typeof fixture>, status = "RUNNING", attemptCount = 1, value = project) {
  f.tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status, attemptCount }] : [value]);
}

describe("outline request and response validation", () => {
  it("keeps established chapter count normalization", () => { expect(normalizeChapterCount(undefined)).toBe(5); expect(normalizeChapterCount("3")).toBe(3); expect(normalizeChapterCount(0)).toBe(5); expect(normalizeChapterCount(999)).toBe(20); });
  it("accepts only exactly requested valid chapters", () => { expect(normalizeDraftedChapters(chapters, 2)).toEqual(chapters); });
  it.each([null, {}, [], [chapters[0]], [...chapters, chapters[0]], [{ title: "", summary: "s" }, chapters[1]], [{ title: "title", summary: "" }, chapters[1]], [{ title: "x".repeat(201), summary: "s" }, chapters[1]], [{ title: "title", summary: "s".repeat(1001) }, chapters[1]], ["invalid", chapters[1]]])("rejects partial or malformed rows %j", raw => { expect(normalizeDraftedChapters(raw, 2)).toEqual([]); });
  it("includes complete prompt source without old summary/premise truncation", () => { const prompt = buildOutlinePrompt({ projectTitle: "长夜", premise: "前".repeat(1250) + "PREMISE_TAIL", genre: null, styleBrief: "风".repeat(420) + "STYLE_TAIL", existingChapters: [{ title: "旧章", summary: "摘".repeat(90) + "SUMMARY_TAIL" }], characterNames: ["林墨"], worldNames: ["枯槐"], chapterCount: 2 }); expect(prompt).toContain("PREMISE_TAIL"); expect(prompt).toContain("STYLE_TAIL"); expect(prompt).toContain("SUMMARY_TAIL"); expect(prompt).toContain("2 章"); });
});
it("creates outlines and final step/job atomically with project source identity", async () => {
  const f = fixture(); f.tx.outline.findMany.mockResolvedValue([node, { ...node, id: "old-chapter", level: "CHAPTER", orderIndex: 7 }]); await f.handler(job);
  expect(f.model.generate).toHaveBeenCalledWith(expect.stringContaining("林墨"), expect.objectContaining({ responseFormat: "json_object" }));
  expect(f.tx.outline.create).toHaveBeenCalledTimes(2);
  expect(f.tx.outline.create.mock.calls[0]?.[0].data).toMatchObject({ parentId: "vol-1", orderIndex: 8, summary: chapters[0]!.summary });
  expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", output: expect.objectContaining({ projectId: job.projectId, createdCount: 2, requestedCount: 2, sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) }) }));
  expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) })); expect(f.updateJobStatus).not.toHaveBeenCalled(); expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce();
});
it.each(["散文", "null", "[]", "{}", "prefix " + valid, JSON.stringify({ chapters: chapters.slice(0, 1) }), JSON.stringify({ chapters: [...chapters, chapters[0]] }), JSON.stringify({ chapters: [{ title: "标题" }, chapters[1]] })])("rejects invalid complete output without appending: %s", async text => { const f = fixture(text); await f.handler(job); expect(f.tx.outline.create).not.toHaveBeenCalled(); expect(f.tx.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorCode: "INVALID_MODEL_OUTPUT" }) })); expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })); expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce(); });
it("allows one JSON code fence", async () => { const f = fixture('```json\n' + valid + '\n```'); await f.handler(job); expect(f.tx.outline.create).toHaveBeenCalledTimes(2); });
it.each(["CANCELLED", "SUCCEEDED", "FAILED"])("does not call a model for preexisting %s", async status => { const f = fixture(); f.prisma.generationJob.findFirst.mockResolvedValue({ status, attemptCount: 1 }); await f.handler(job); expect(f.model.generate).not.toHaveBeenCalled(); });
it("does not call a model for an old attempt or wrong handler type", async () => { const f = fixture(); f.prisma.generationJob.findFirst.mockResolvedValue({ status: "RUNNING", attemptCount: 2 }); await f.handler(job); await f.handler({ ...job, jobType: "REVIEW" }); expect(f.model.generate).not.toHaveBeenCalled(); });
it.each([{ targetEntityType: "CHAPTER", targetEntityId: "chapter" }, { targetEntityType: "PROJECT", targetEntityId: "other" }, { input: { projectId: "other" } }])("rejects conflicting project target %j", async override => { const f = fixture(); await f.handler({ ...job, ...override } as GenerationJob); expect(f.model.generate).not.toHaveBeenCalled(); expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "PROJECT_TARGET_MISMATCH", expectedStatus: "RUNNING", expectedAttemptCount: 1 })); });
it("fails a missing project before resolving a model", async () => { const f = fixture(); f.tx.$queryRaw.mockResolvedValue([]); f.prisma.project.findFirst.mockResolvedValue(null); const resolveModel = vi.fn(); await createGenerateOutlineHandler({ prisma: f.prisma as never, updateJobStatus: f.updateJobStatus, resolveModel })(job); expect(resolveModel).not.toHaveBeenCalled(); expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "PROJECT_NOT_FOUND" })); });
it("rejects oversized complete context before model resolution", async () => { const f = fixture(); locked(f, "RUNNING", 1, { ...project, premise: "字".repeat(40001) }); const resolveModel = vi.fn(); await createGenerateOutlineHandler({ prisma: f.prisma as never, updateJobStatus: f.updateJobStatus, resolveModel })(job); expect(resolveModel).not.toHaveBeenCalled(); expect(f.prisma.generationStep.create).not.toHaveBeenCalled(); expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "OUTLINE_SOURCE_TOO_LONG" })); });
it.each(["CANCELLED", "SUCCEEDED", "FAILED"])("skips late response after %s without outlines", async status => { const f = fixture(); locked(f, status); await f.handler(job); expect(f.tx.outline.create).not.toHaveBeenCalled(); expect(f.tx.generationJob.update).not.toHaveBeenCalled(); expect(f.tx.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED" }) })); });
it("skips old response attempt but still records response usage", async () => { const f = fixture(); locked(f, "RUNNING", 2); await f.handler(job); expect(f.tx.outline.create).not.toHaveBeenCalled(); expect(f.prisma.usageEvent.create).toHaveBeenCalledOnce(); });
it("rejects changed outline source and preserves hand-authored node", async () => { const f = fixture(); f.tx.outline.findMany.mockResolvedValueOnce([node]).mockResolvedValueOnce([{ ...node, summary: "作者后来改纲" }]); await expect(f.handler(job)).rejects.toThrow("大纲来源已变化"); expect(f.tx.outline.create).not.toHaveBeenCalled(); expect(f.prisma.generationStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "RUNNING" }) })); });
it("rejects changed project prompt fields", async () => { const f = fixture(); f.tx.$queryRaw.mockImplementationOnce(async () => [project]).mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1 }] : [{ ...project, premise: "作者新梗概" }]); await expect(f.handler(job)).rejects.toThrow("大纲来源已变化"); expect(f.tx.outline.create).not.toHaveBeenCalled(); });
it.each(["SUCCEEDED", "FAILED", "SKIPPED"])("recovers committed %s step after lost transaction acknowledgment", async status => { const f = fixture(status === "FAILED" ? "invalid" : valid); if (status === "SKIPPED") locked(f, "CANCELLED"); const normal = f.prisma.$transaction.getMockImplementation()!; let count = 0; f.prisma.$transaction.mockImplementation(async cb => { const value = await normal(cb); if (++count === 2) { f.prisma.generationStep.findFirst.mockResolvedValue({ status }); throw new Error("ack lost"); } return value; }); await expect(f.handler(job)).resolves.toBeUndefined(); expect(f.prisma.generationStep.updateMany).not.toHaveBeenCalled(); expect(f.model.generate).toHaveBeenCalledOnce(); });
it("keeps original provider error if receipt read and cleanup fail", async () => { const f = fixture(); const denied = Object.assign(new Error("Unauthorized"), { status: 401 }); f.model.generate.mockRejectedValue(denied); f.prisma.generationStep.findFirst.mockRejectedValue(new Error("receipt unavailable")); f.prisma.generationStep.updateMany.mockRejectedValue(new Error("cleanup unavailable")); await expect(f.handler(job)).rejects.toBe(denied); expect(f.tx.outline.create).not.toHaveBeenCalled(); });
