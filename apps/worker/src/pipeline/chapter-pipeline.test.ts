import { describe, expect, it, vi } from "vitest";
import { runChapterPipeline, type PipelineDeps } from "./chapter-pipeline";

function mockDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    buildContext: vi.fn().mockReturnValue({
      prompt: "组装好的上下文",
      activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" }
    }),
    model: {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: '{"chapterGoal":"开门","sceneBeats":[],"charactersInScene":["陈锋"]}', inputTokens: 10, outputTokens: 5 })
        .mockResolvedValueOnce({ text: "第一章正文内容——星门在闪烁中缓缓开启", inputTokens: 200, outputTokens: 80 })
        .mockResolvedValueOnce({ text: '{"issues":[{"type":"consistency","detail":"人设不一致"}]}', inputTokens: 100, outputTokens: 30 })
        .mockResolvedValueOnce({ text: "第一章正文内容——星门在闪烁中缓缓开启（修订版）", inputTokens: 200, outputTokens: 100 })
        .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"星门成功开启","chapterSummary":"陈锋团队激活星门"}' as string, inputTokens: 50, outputTokens: 60 } as { text: string; inputTokens: number; outputTokens: number })
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
    expect(deps.model.generate).toHaveBeenCalledTimes(5); // plan, draft, review, revise, extract
    expect(deps.persistVersion).toHaveBeenCalledOnce();
    expect(deps.createStep).toHaveBeenCalledTimes(6);
    expect(deps.updateStep).toHaveBeenCalledTimes(6);
    expect(result.steps.map((s) => s.stepKey)).toEqual([
      "plan", "draft", "review", "revise", "persist_version", "extract_memory"
    ]);
  });

  it("persists the final revised content", async () => {
    const deps = mockDeps();

    await runChapterPipeline(deps);

    expect(deps.persistVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("修订版"),
        source: "AI"
      })
    );
  });

  it("skips revise step when review finds no issues", async () => {
    const deps = mockDeps({
      model: {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: '{"chapterGoal":"x","sceneBeats":[],"charactersInScene":[]}', inputTokens: 10, outputTokens: 5 })
          .mockResolvedValueOnce({ text: "正文", inputTokens: 10, outputTokens: 2 })
          .mockResolvedValueOnce({ text: '{"issues":[]}', inputTokens: 10, outputTokens: 2 })
          .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"","chapterSummary":""}', inputTokens: 10, outputTokens: 2 })
      }
    });

    await runChapterPipeline(deps);

    // revise 步骤应该被跳过（或直接保持 draft 内容不变）
    const stepsResult = (deps.persistVersion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { content: string } | undefined;
    expect(stepsResult?.content).toBe("正文");
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
      .mockResolvedValueOnce({ text: "正文", inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"issues":[]}', inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"","chapterSummary":""}', inputTokens: 10, outputTokens: 2 });

    const deps = mockDeps({
      buildContext: vi.fn().mockReturnValue({
        prompt: "上下文",
        activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" },
        methodologyGuide: {
          name: "三幕式", methodType: "three_act",
          guideText: "建立 → 对抗 → 解决",
          reviewCriteria: ["激励事件清晰", "高潮回应主线"]
        }
      }),
      model: { generate }
    });

    await runChapterPipeline(deps);

    const planPromptArg = generate.mock.calls[0]?.[0] as string;
    expect(planPromptArg).toContain("方法论对齐");
    expect(planPromptArg).toContain("三幕式");
  });

  it("injects banned words and review criteria into review prompt", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '{"chapterGoal":"x","sceneBeats":[],"charactersInScene":[]}', inputTokens: 10, outputTokens: 5 })
      .mockResolvedValueOnce({ text: "正文", inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"issues":[]}', inputTokens: 10, outputTokens: 2 })
      .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"","chapterSummary":""}', inputTokens: 10, outputTokens: 2 });

    const deps = mockDeps({
      buildContext: vi.fn().mockReturnValue({
        prompt: "上下文",
        activationReport: { activated: [], totalSourcesChecked: 0, triggeredBy: "" },
        styleGuide: { banned: ["仿佛", "似乎"] },
        methodologyGuide: {
          name: "网文", methodType: "webnovel_speed",
          guideText: "爽点节奏",
          reviewCriteria: ["每章必有钩子"]
        }
      }),
      model: { generate }
    });

    await runChapterPipeline(deps);

    const reviewPromptArg = generate.mock.calls[2]?.[0] as string;
    expect(reviewPromptArg).toContain("禁用词");
    expect(reviewPromptArg).toContain("仿佛");
    expect(reviewPromptArg).toContain("方法论必查项");
    expect(reviewPromptArg).toContain("每章必有钩子");
  });
});
