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

function createPrismaStub(chapter: unknown = defaultChapter()) {
  return {
    chapter: {
      findFirst: vi.fn().mockResolvedValue(chapter)
    },
    generationStep: {
      create: vi.fn().mockResolvedValue({ id: "step-1" }),
      update: vi.fn().mockResolvedValue({})
    }
  };
}

function defaultChapter() {
  return {
    id: "chapter-1",
    title: "Chapter One",
    outlineSummary: "Open the gate",
    content: "The gate opens and the protagonist makes a dangerous choice.",
    project: {
      title: "Test Novel",
      styleBrief: "Tense and clear"
    }
  };
}

describe("createDiagnoseChapterHandler", () => {
  it("fails when chapter is missing", async () => {
    const prisma = createPrismaStub(null);
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: { generate: vi.fn() } as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "FAILED",
        errorCode: "CHAPTER_NOT_FOUND"
      })
    );
  });

  it("completes with diagnostic and performance summaries", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const model = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          readerScore: 82,
          abandonRisk: "low",
          hookStrength: 76,
          pacingScore: 70,
          styleDrift: 12,
          continuityIssues: [{ severity: "warning", detail: "Timeline is vague", suggestion: "Name the day." }],
          suggestions: ["Sharpen the final hook."]
        }),
        inputTokens: 120,
        outputTokens: 80
      })
    };
    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: model as never
    });

    await handler(baseJob);

    expect(prisma.generationStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stepKey: "diagnose_chapter" })
      })
    );
    expect(prisma.generationStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "step-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          inputTokens: 120,
          outputTokens: 80
        })
      })
    );
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "SUCCEEDED",
        output: expect.objectContaining({
          diagnosticSummary: expect.objectContaining({
            readerScore: 82,
            abandonRisk: "low",
            suggestions: ["Sharpen the final hook."]
          }),
          performanceSummary: expect.objectContaining({
            modelCalls: 1,
            inputTokens: 120,
            outputTokens: 80
          })
        })
      })
    );
  });

  it("returns a degraded diagnostic summary for malformed model output", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: {
        generate: vi.fn().mockResolvedValue({ text: "not json", inputTokens: 20, outputTokens: 5 })
      } as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        output: expect.objectContaining({
          diagnosticSummary: expect.objectContaining({
            readerScore: 0,
            abandonRisk: "medium",
            suggestions: expect.arrayContaining(["Diagnostic output could not be parsed."])
          })
        })
      })
    );
  });
});
