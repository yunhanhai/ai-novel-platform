import { describe, expect, it, vi } from "vitest";
import { createDiagnoseChapterHandler } from "./diagnose-chapter-handler";
import { normalizePerformanceBudget } from "@ai-novel/shared/generation/performance";
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
    },
    usageEvent: {
      create: vi.fn().mockResolvedValue({})
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

  it("uses focused diagnostic profiles for specialized job types", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const model = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          readerScore: 72,
          abandonRisk: "medium",
          hookStrength: 60,
          pacingScore: 64,
          styleDrift: 38,
          continuityIssues: [],
          suggestions: ["Align sentence rhythm with the style brief."]
        }),
        inputTokens: 90,
        outputTokens: 40
      })
    };
    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: model as never
    });

    await handler({
      ...baseJob,
      id: "job-style",
      jobType: "STYLE_DRIFT_CHECK"
    });

    expect(prisma.generationStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stepKey: "style_drift_check" })
      })
    );
    expect(model.generate).toHaveBeenCalledWith(expect.stringContaining("Focus: detect style drift"));
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          diagnosticType: "style_drift_check",
          diagnosticSummary: expect.objectContaining({ styleDrift: 38 })
        })
      })
    );
  });

  it("records usage events for resolved real diagnostic model calls", async () => {
    const prisma = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const resolvedModel = {
      usage: {
        providerId: "provider-1",
        modelName: "claude-test",
        billingSource: "PLATFORM" as const
      },
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          readerScore: 91,
          abandonRisk: "low",
          hookStrength: 80,
          pacingScore: 78,
          styleDrift: 8,
          continuityIssues: [],
          suggestions: ["Keep the current rhythm."]
        }),
        inputTokens: 70,
        outputTokens: 35
      })
    };
    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: { generate: vi.fn() } as never,
      resolveModel: vi.fn(async () => resolvedModel) as never
    });

    await handler(baseJob);

    expect(prisma.usageEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          userId: "user-1",
          projectId: "proj-1",
          generationJobId: "job-1",
          providerId: "provider-1",
          modelName: "claude-test",
          billingSource: "PLATFORM",
          inputTokens: 70,
          outputTokens: 35,
          latencyMs: expect.any(Number)
        })
      })
    );
  });

  it("skips diagnostic model calls when the input budget is exhausted", async () => {
    const chapter = {
      ...defaultChapter(),
      content: "A".repeat(8000)
    };
    const prisma = createPrismaStub(chapter);
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const model = {
      generate: vi.fn()
    };
    const handler = createDiagnoseChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: model as never
    });

    await handler({
      ...baseJob,
      input: {
        qualityMode: "fast",
        performanceBudget: normalizePerformanceBudget("fast", { maxInputTokens: 1000 })
      }
    });

    expect(model.generate).not.toHaveBeenCalled();
    expect(prisma.generationStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "step-1" },
        data: expect.objectContaining({
          status: "SKIPPED",
          outputPreview: "budget_input_tokens"
        })
      })
    );
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        output: expect.objectContaining({
          diagnosticType: "diagnose_chapter",
          performanceSummary: expect.objectContaining({
            skippedSteps: [
              expect.objectContaining({
                stepKey: "diagnose_chapter",
                reason: "budget_input_tokens"
              })
            ]
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
