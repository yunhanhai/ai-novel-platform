import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewHandler, verifySuggestions, type ReviewSuggestion } from "./review-handler";
import type { GenerationJob } from "../poll";

const chapterContent = "他推开门，屋里的灰尘扑面而来。她坐在窗边，头也不抬。空气里有一种说不出的味道。";

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "proj-1",
    userId: "user-1",
    jobType: "REVIEW",
    status: "RUNNING",
    input: { chapterId: "ch-1" },
    targetEntityType: "CHAPTER",
    targetEntityId: "ch-1",
    ...overrides
  } as GenerationJob;
}

function makePrisma(content: string | null = chapterContent) {
  const generationStep = {
    create: vi.fn().mockResolvedValue({ id: "step-1" }),
    update: vi.fn().mockResolvedValue({})
  };
  const prisma = {
    chapter: {
      findFirst: vi.fn().mockResolvedValue(
        content === null ? null : { id: "ch-1", title: "第一章", content }
      )
    },
    generationStep
  };
  return { prisma: prisma as never, generationStep };
}

function modelReturning(text: string) {
  return { generate: vi.fn().mockResolvedValue({ text, inputTokens: 100, outputTokens: 50 }) };
}

describe("verifySuggestions", () => {
  it("marks quotes that exist verbatim in the content as verified", () => {
    const result = verifySuggestions("一二三四五", [
      { issueType: "typo", severity: "warning", quote: "三四", problem: "p", suggestion: "s", replacement: "x" },
      { issueType: "typo", severity: "warning", quote: "九九", problem: "p", suggestion: "s", replacement: "y" }
    ]);

    expect(result[0]!.verified).toBe(true);
    expect(result[1]!.verified).toBe(false);
  });
});

describe("createReviewHandler", () => {
  const updateJobStatus = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({});

  beforeEach(() => {
    updateJobStatus.mockClear();
  });

  it("returns verified suggestions with counts", async () => {
    const { prisma } = makePrisma();
    const payload = JSON.stringify({
      summary: "整体可用，个别句子偏空",
      passed: false,
      suggestions: [
        {
          issueType: "ai_slop",
          severity: "warning",
          quote: "空气里有一种说不出的味道",
          problem: "空泛描写",
          suggestion: "换成具体的气味",
          replacement: "屋里有一股陈年的霉味"
        },
        {
          issueType: "consistency",
          severity: "info",
          quote: "这句话在正文里根本不存在",
          problem: "编造的引文",
          suggestion: "n/a",
          replacement: ""
        }
      ]
    });
    const model = modelReturning(payload);
    const handler = createReviewHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const call = updateJobStatus.mock.calls[0]![0] as {
      status: string;
      output: { review: { suggestions: ReviewSuggestion[]; verifiedCount: number; unverifiedCount: number; summary: string; passed: boolean } };
    };
    expect(call.status).toBe("SUCCEEDED");
    expect(call.output.review.summary).toContain("整体可用");
    expect(call.output.review.passed).toBe(false);
    expect(call.output.review.verifiedCount).toBe(1);
    expect(call.output.review.unverifiedCount).toBe(1);
    expect(call.output.review.suggestions[0]!.verified).toBe(true);
    expect(call.output.review.suggestions[1]!.verified).toBe(false);
  });

  it("strips a code fence around the JSON payload", async () => {
    const { prisma } = makePrisma();
    const model = modelReturning(
      "```json\n" + JSON.stringify({ summary: "ok", passed: true, suggestions: [] }) + "\n```"
    );
    const handler = createReviewHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const call = updateJobStatus.mock.calls[0]![0] as { output: { review: { passed: boolean; degraded: boolean } } };
    expect(call.output.review.passed).toBe(true);
    expect(call.output.review.degraded).toBe(false);
  });

  it("flags degraded output when the model returns non-JSON prose", async () => {
    const { prisma } = makePrisma();
    const model = modelReturning("这一章写得不错，没什么问题。");
    const handler = createReviewHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const call = updateJobStatus.mock.calls[0]![0] as {
      output: { review: { degraded: boolean; suggestions: unknown[]; passed: boolean } };
    };
    expect(call.output.review.degraded).toBe(true);
    expect(call.output.review.suggestions).toEqual([]);
    expect(call.output.review.passed).toBe(true);
  });

  it("drops malformed suggestions and falls back to valid enum values", async () => {
    const { prisma } = makePrisma();
    const payload = JSON.stringify({
      suggestions: [
        { quote: "他推开门", problem: "缺少主语信息", issueType: "bogus", severity: "bogus" },
        { problem: "缺少 quote 应被丢弃" },
        "not-an-object"
      ]
    });
    const model = modelReturning(payload);
    const handler = createReviewHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    const call = updateJobStatus.mock.calls[0]![0] as {
      output: { review: { suggestions: ReviewSuggestion[] } };
    };
    expect(call.output.review.suggestions).toHaveLength(1);
    expect(call.output.review.suggestions[0]!.issueType).toBe("consistency");
    expect(call.output.review.suggestions[0]!.severity).toBe("warning");
  });

  it("fails deterministically when the chapter is missing", async () => {
    const { prisma } = makePrisma(null);
    const model = modelReturning("{}");
    const handler = createReviewHandler({ prisma, updateJobStatus, model: model as never });

    await handler(makeJob());

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("rethrows model failures so the poller can retry", async () => {
    const { prisma } = makePrisma();
    const model = { generate: vi.fn().mockRejectedValue(new Error("provider timeout")) };
    const handler = createReviewHandler({ prisma, updateJobStatus, model: model as never });

    await expect(handler(makeJob())).rejects.toThrow("provider timeout");
    expect(updateJobStatus).not.toHaveBeenCalled();
  });
});
