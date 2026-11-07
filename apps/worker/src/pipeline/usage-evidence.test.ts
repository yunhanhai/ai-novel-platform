import { describe, expect, it, vi } from "vitest";
import { createDeslopHandler } from "./deslop-handler";
import { createDiagnoseChapterHandler } from "./diagnose-chapter-handler";
import { createExtractMemoryHandler } from "./extract-memory-handler";
import type { GenerationJob } from "../poll";

const baseJob: GenerationJob = { id: "job", organizationId: "org", projectId: "project", userId: "user", jobType: "DESLOP", status: "RUNNING", input: {}, targetEntityType: "CHAPTER", targetEntityId: "chapter" };

function setup() {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("FROM generation_jobs") ? [{ status: "RUNNING", attemptCount: 1 }] : [{id:"chapter",content:"正文",title:"标题",chapterNo:1}]),
    generationStep: { create: vi.fn().mockResolvedValue({ id: "step" }), update: vi.fn().mockResolvedValue({}) },
    generationJob: { update: vi.fn().mockResolvedValue({}) },
    projectMemory: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
  };
  const prisma = {
    generationJob: { findFirst: vi.fn().mockResolvedValue({ status: "RUNNING", attemptCount: 1 }) },
    chapter: { findFirst: vi.fn().mockResolvedValue({ id: "chapter", title: "标题", content: "正文", chapterNo: 1 }) },
    generationStep: { create: vi.fn().mockResolvedValue({ id: "step" }), update: vi.fn().mockResolvedValue({}) },
    usageEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx))
  };
  const model = { modelName: "model-real", billingSource: "USER_KEY" as const, generate: vi.fn().mockResolvedValue({ text: '{"issues":[],"overallScore":90,"summary":"摘要","characterChanges":[],"worldFacts":[],"newHooks":[],"chapterSummary":"摘要"}', inputTokens: 81, outputTokens: 27 }) };
  const updateJobStatus = vi.fn().mockResolvedValue({});
  return { prisma, model, updateJobStatus };
}

describe("standalone model usage evidence", () => {
  it.each([
    ["DESLOP", createDeslopHandler],
    ["DIAGNOSE_CHAPTER", createDiagnoseChapterHandler],
    ["EXTRACT_MEMORY", createExtractMemoryHandler]
  ] as const)("records one metered call for %s without changing the job result", async (jobType, createHandler) => {
    const { prisma, model, updateJobStatus } = setup();
    const handler = createHandler({ prisma: prisma as never, resolveModel: async () => model, updateJobStatus });
    await handler({ ...baseJob, jobType });
    expect(prisma.usageEvent.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      organizationId: "org", projectId: "project", userId: "user", generationJobId: "job",
      modelName: "model-real", billingSource: "USER_KEY", inputTokens: 81, outputTokens: 27, latencyMs: expect.any(Number)
    }) });
    const serialized = JSON.stringify(prisma.usageEvent.create.mock.calls);
    expect(serialized).not.toContain("正文");
  });

  it("keeps a completed diagnostic usable when usage recording is unavailable", async () => {
    const { prisma, model, updateJobStatus } = setup();
    prisma.usageEvent.create.mockRejectedValue(new Error("meter unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await createDiagnoseChapterHandler({ prisma: prisma as never, resolveModel: async () => model, updateJobStatus })(baseJob);
      expect(prisma.usageEvent.create).toHaveBeenCalledOnce();
      expect(updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "SUCCEEDED" }));
      expect(warn).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });
});
