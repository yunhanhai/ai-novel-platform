import { describe, expect, it, vi } from "vitest";
import { runChapterPipeline, type PipelineDeps } from "./chapter-pipeline";
import { normalizePerformanceBudget } from "@ai-novel/shared/generation/performance";

function mockDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    buildContext: vi.fn().mockReturnValue({
      prompt: "assembled context",
      activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" }
    }),
    model: {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: '{"chapterGoal":"open","sceneBeats":[],"charactersInScene":["Chen"]}', inputTokens: 10, outputTokens: 5 })
        .mockResolvedValueOnce({ text: "chapter draft content", inputTokens: 200, outputTokens: 80 })
        .mockResolvedValueOnce({ text: '{"issues":[{"type":"consistency","detail":"voice drift","severity":"warning"}]}', inputTokens: 100, outputTokens: 30 })
        .mockResolvedValueOnce({ text: "chapter revised content", inputTokens: 200, outputTokens: 100 })
        .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"gate opened","chapterSummary":"Chen activates the gate"}', inputTokens: 50, outputTokens: 60 } as { text: string; inputTokens: number; outputTokens: number })
    },
    persistVersion: vi.fn().mockResolvedValue({ id: "v1", versionNo: 1 }),
    createStep: vi.fn().mockResolvedValue({ id: "step-1" }),
    updateStep: vi.fn().mockResolvedValue({}),
    job: {
      id: "j1", organizationId: "org1", projectId: "p1", userId: "u1",
      jobType: "GENERATE_CHAPTER", input: { chapterId: "c5" }
    },
    ...overrides
  };
}

describe("chapter-pipeline", () => {
  it("executes all six steps in order", async () => {
    const deps = mockDeps();

    const result = await runChapterPipeline(deps);

    expect(deps.buildContext).toHaveBeenCalledOnce();
    expect(deps.model.generate).toHaveBeenCalledTimes(5);
    expect(deps.persistVersion).toHaveBeenCalledOnce();
    expect(deps.createStep).toHaveBeenCalledTimes(6);
    expect(deps.updateStep).toHaveBeenCalledTimes(6);
    expect(result.steps.map((s) => s.stepKey)).toEqual([
      "plan", "draft", "review", "revise", "persist_version", "extract_memory"
    ]);
  });

  it("records a bounded prompt snapshot for model-backed steps", async () => {
    const deps = mockDeps({
      buildContext: vi.fn().mockReturnValue({
        prompt: "CONTEXT_DIAGNOSTIC_MARKER".repeat(500),
        activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" }
      })
    });

    await runChapterPipeline(deps);

    const firstUpdate = (deps.updateStep as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { promptSnapshot?: string } | undefined;
    expect(firstUpdate?.promptSnapshot).toContain("CONTEXT_DIAGNOSTIC_MARKER");
    expect(firstUpdate?.promptSnapshot).toHaveLength(4000);
  });

  it("persists the final revised content", async () => {
    const deps = mockDeps();

    await runChapterPipeline(deps);

    expect(deps.persistVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("revised"),
        source: "AI"
      })
    );
  });

  it("skips revise step when review finds no issues", async () => {
    const deps = mockDeps({
      model: {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: '{"chapterGoal":"x","sceneBeats":[],"charactersInScene":[]}', inputTokens: 10, outputTokens: 5 })
          .mockResolvedValueOnce({ text: "draft only", inputTokens: 10, outputTokens: 2 })
          .mockResolvedValueOnce({ text: '{"issues":[]}', inputTokens: 10, outputTokens: 2 })
          .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"","chapterSummary":""}', inputTokens: 10, outputTokens: 2 })
      }
    });

    await runChapterPipeline(deps);

    const stepsResult = (deps.persistVersion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { content: string } | undefined;
    expect(stepsResult?.content).toBe("draft only");
  });

  it("extract_memory step records proposed memories", async () => {
    const deps = mockDeps();

    const result = await runChapterPipeline(deps);

    expect(result.extracted).toBeDefined();
    expect(result.extracted.chapterSummary).toBeDefined();
  });

  it("fails gracefully when plan generation throws", async () => {
    const deps = mockDeps({
      model: {
        generate: vi.fn().mockRejectedValue(new Error("API error"))
      }
    });

    await expect(runChapterPipeline(deps)).rejects.toThrow("API error");
  });

  it("injects methodology hint into plan prompt when methodologyGuide is present", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '{"chapterGoal":"x","sceneBeats":[],"charactersInScene":[]}', inputTokens: 10, outputTokens: 5 })
      .mockResolvedValueOnce({ text: "draft", inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"issues":[]}', inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"","chapterSummary":""}', inputTokens: 10, outputTokens: 2 });

    const deps = mockDeps({
      buildContext: vi.fn().mockReturnValue({
        prompt: "context",
        activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" },
        methodologyGuide: {
          name: "three act", methodType: "three_act",
          guideText: "setup -> confrontation -> resolution",
          reviewCriteria: ["inciting incident is clear", "climax responds to main thread"]
        }
      }),
      model: { generate }
    });

    await runChapterPipeline(deps);

    const planPromptArg = generate.mock.calls[0]?.[0] as string;
    expect(planPromptArg).toContain("three act");
  });

  it("injects banned words and review criteria into review prompt", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '{"chapterGoal":"x","sceneBeats":[],"charactersInScene":[]}', inputTokens: 10, outputTokens: 5 })
      .mockResolvedValueOnce({ text: "draft", inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"issues":[]}', inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"","chapterSummary":""}', inputTokens: 10, outputTokens: 2 });

    const deps = mockDeps({
      buildContext: vi.fn().mockReturnValue({
        prompt: "context",
        activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" },
        styleGuide: { banned: ["cliche", "suddenly"] },
        methodologyGuide: {
          name: "web novel", methodType: "webnovel_speed",
          guideText: "fast beats",
          reviewCriteria: ["each chapter has a hook"]
        }
      }),
      model: { generate }
    });

    await runChapterPipeline(deps);

    const reviewPromptArg = generate.mock.calls[2]?.[0] as string;
    expect(reviewPromptArg).toContain("cliche");
    expect(reviewPromptArg).toContain("each chapter has a hook");
  });

  it("writes every pipeline prompt in Chinese for Chinese web novels", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '{"chapterGoal":"x","sceneBeats":[],"charactersInScene":[]}', inputTokens: 10, outputTokens: 5 })
      .mockResolvedValueOnce({ text: "草稿正文", inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"issues":[{"type":"pacing","detail":"节奏拖沓","severity":"warning"}]}', inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: "修改后的正文", inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"","chapterSummary":""}', inputTokens: 10, outputTokens: 2 });

    const deps = mockDeps({ model: { generate } });

    await runChapterPipeline(deps);

    const prompts = generate.mock.calls.map((call) => call[0] as string);
    // plan / draft / review / revise / extract 五步都应产生调用
    expect(prompts.length).toBeGreaterThanOrEqual(5);

    for (const prompt of prompts) {
      // 面向中文网文，指令必须是中文——英文指令会让模型先英文思考再翻译，损伤文风
      expect(prompt).toMatch(/[\u4e00-\u9fff]/);
      expect(prompt).not.toMatch(/\bYou are\b/);
    }
  });

  it("skips review and revise in fast mode", async () => {
    const deps = mockDeps({
      performance: { qualityMode: "fast", budget: normalizePerformanceBudget("fast", undefined) }
    });

    const result = await runChapterPipeline(deps);

    expect(result.steps.find((s) => s.stepKey === "review")).toMatchObject({
      status: "SKIPPED",
      outputPreview: "quality_mode"
    });
    expect(result.steps.find((s) => s.stepKey === "revise")).toMatchObject({
      status: "SKIPPED",
      outputPreview: "quality_mode"
    });
    expect(result.performanceSummary.qualityMode).toBe("fast");
    expect(result.performanceSummary.skippedSteps).toContainEqual({ stepKey: "review", reason: "quality_mode" });
  });

  it("skips optional model steps when the budget is exhausted", async () => {
    const deps = mockDeps({
      performance: { qualityMode: "balanced", budget: normalizePerformanceBudget("balanced", { maxModelCalls: 2 }) }
    });

    const result = await runChapterPipeline(deps);

    expect(result.steps.find((s) => s.stepKey === "review")).toMatchObject({ status: "SKIPPED" });
    expect(result.performanceSummary.modelCalls).toBe(2);
  });
});