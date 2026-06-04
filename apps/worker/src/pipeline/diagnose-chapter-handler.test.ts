import { describe, expect, it, vi } from "vitest";
import { createDiagnoseChapterHandler } from "./diagnose-chapter-handler";
import type { GenerationJob } from "../poll";

const baseJob: GenerationJob = {
  id: "job-1",
  organizationId: "org-1",
  projectId: "proj-1",
  userId: "user-1",
  jobType: "DIAGNOSE_CHAPTER",
  status: "RUNNING",
  input: {},
  targetEntityType: "CHAPTER",
  targetEntityId: "chapter-1"
};

const validModel = {
  generate: vi.fn().mockResolvedValue({
    text: '{"readerScore":82,"abandonRisk":"low","hookStrength":70,"pacingScore":75,"styleDrift":10,"continuityIssues":[{"severity":"warning","detail":"时间线小问题","suggestion":"补一句过渡"}],"suggestions":["增强结尾钩子"]}',
    inputTokens: 120,
    outputTokens: 60
  })
};

function createPrismaStub(options: { chapterMissing?: boolean } = {}) {
  const chapter = options.chapterMissing
    ? null
    : {
        id: "chapter-1",
        title: "第一章",
        outlineSummary: "主角登场",
        content: "这是足够长的章节正文内容。",
        project: { title: "测试作品", styleBrief: "通俗易读" }
      };
  return {
    chapter: { findFirst: vi.fn().mockResolvedValue(chapter) },
    generationStep: {
      create: vi.fn().mockResolvedValue({ id: "step-1" }),
      update: vi.fn().mockResolvedValue({})
    }
  };
}

describe("createDiagnoseChapterHandler", () => {
  it("fails with CHAPTER_NOT_FOUND when chapter is missing", async () => {
    const prisma = createPrismaStub({ chapterMissing: true });
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: validModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
  });

  it("completes with diagnosticSummary and performanceSummary on valid output", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: validModel as never
    });

    await handler(baseJob);

    expect(prisma.generationStep.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stepKey: "diagnose_chapter" }) })
    );
    expect(prisma.generationStep.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) })
    );
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "SUCCEEDED",
        output: expect.objectContaining({
          diagnosticSummary: expect.objectContaining({
            readerScore: expect.any(Number),
            abandonRisk: expect.any(String),
            suggestions: expect.any(Array)
          }),
          performanceSummary: expect.objectContaining({ modelCalls: 1 })
        })
      })
    );
  });

  it("clamps out-of-range scores into 0..100", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const outlierModel = {
      generate: vi.fn().mockResolvedValue({
        text: '{"readerScore":999,"abandonRisk":"nonsense","hookStrength":-5,"pacingScore":50,"styleDrift":12,"continuityIssues":[],"suggestions":[]}',
        inputTokens: 10,
        outputTokens: 5
      })
    };

    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: outlierModel as never
    });

    await handler(baseJob);

    const call = updateJobStatus.mock.calls.find((c) => c[0]?.status === "SUCCEEDED");
    const summary = call?.[0]?.output?.diagnosticSummary;
    expect(summary.readerScore).toBe(100);
    expect(summary.hookStrength).toBe(0);
    expect(summary.abandonRisk).toBe("medium");
  });

  it("returns a degraded diagnostic summary instead of throwing on malformed JSON", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const badModel = {
      generate: vi.fn().mockResolvedValue({ text: "这是一段非 JSON 的普通文字。", inputTokens: 8, outputTokens: 4 })
    };

    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: badModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "SUCCEEDED",
        output: expect.objectContaining({
          diagnosticDegraded: true,
          diagnosticSummary: expect.objectContaining({ readerScore: expect.any(Number) })
        })
      })
    );
  });

  it("fails with NO_MODEL_PROFILE when resolveModel returns null and no fallback model", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const resolveModel = vi.fn(async () => null);

    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      resolveModel: resolveModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", status: "FAILED", errorCode: "NO_MODEL_PROFILE" })
    );
  });

  it("uses a focused prompt for diagnosticType variants", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const captureModel = {
      generate: vi.fn().mockResolvedValue({ text: "{}", inputTokens: 1, outputTokens: 1 })
    };

    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: captureModel as never,
      diagnosticType: "STYLE_DRIFT_CHECK"
    });

    await handler(baseJob);

    const prompt = captureModel.generate.mock.calls[0]![0] as string;
    expect(prompt).toContain("styleDrift");
    expect(prompt).toContain("文风");
  });
});
