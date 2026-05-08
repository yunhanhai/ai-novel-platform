import { describe, expect, it, vi } from "vitest";
import { runGenerateChapterPipeline } from "./generate-chapter";

function mockDeps(overrides: Partial<Parameters<typeof runGenerateChapterPipeline>[0]> = {}) {
  return {
    job: {
      id: "j1", organizationId: "org1", projectId: "p1", userId: "u1",
      jobType: "GENERATE_CHAPTER" as const, input: { chapterId: "c1" }
    },
    model: {
      generate: vi.fn().mockResolvedValue({ text: "生成正文", inputTokens: 100, outputTokens: 4 })
    },
    createStep: vi.fn().mockResolvedValue({ id: "s1" }),
    updateStep: vi.fn().mockResolvedValue({}),
    saveContentVersion: vi.fn().mockResolvedValue({ id: "cv1", versionNo: 1 }),
    findChapter: vi.fn().mockResolvedValue({ id: "c1", chapterNo: 1, title: "第一章" }),
    ...overrides
  };
}

describe("generate-chapter pipeline", () => {
  it("calls the model and persists result", async () => {
    const deps = mockDeps();

    await runGenerateChapterPipeline(deps);

    expect(deps.model.generate).toHaveBeenCalledOnce();
    expect(deps.saveContentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ content: "生成正文" })
    );
    expect(deps.createStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepKey: "draft" })
    );
  });

  it("persists content version with AI source", async () => {
    const deps = mockDeps();

    await runGenerateChapterPipeline(deps);

    expect(deps.saveContentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ source: "AI" })
    );
  });

  it("marks step as succeeded", async () => {
    const deps = mockDeps();

    await runGenerateChapterPipeline(deps);

    expect(deps.updateStep).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCEEDED" })
    );
  });
});
