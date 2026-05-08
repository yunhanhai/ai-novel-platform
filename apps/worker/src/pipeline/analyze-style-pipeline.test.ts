import { describe, expect, it, vi } from "vitest";
import { runStyleAnalysisPipeline } from "./analyze-style-pipeline";

function fakeModel(text: string) {
  return {
    generate: vi.fn().mockResolvedValue({
      text,
      inputTokens: 100,
      outputTokens: 50
    })
  };
}

describe("analyze-style-pipeline", () => {
  it("rejects empty reference texts", async () => {
    const model = fakeModel("{}");
    await expect(
      runStyleAnalysisPipeline({ referenceTexts: [], model })
    ).rejects.toThrow(/至少需要/);
  });

  it("returns stats and parsed model summary", async () => {
    const model = fakeModel(
      '{"styleBrief":"短句多动词，对白密集","bannedSuggestions":["仿佛","似乎"],"preferredSuggestions":["剑光","杀意"],"rhythmNotes":"段落短促"}'
    );

    const result = await runStyleAnalysisPipeline({
      referenceTexts: [
        "他推开门走了进去。屋里漆黑一片。",
        "剑光一闪，杀意凛然。"
      ],
      model
    });

    expect(result.styleBrief).toBe("短句多动词，对白密集");
    expect(result.bannedSuggestions).toEqual(["仿佛", "似乎"]);
    expect(result.preferredSuggestions).toEqual(["剑光", "杀意"]);
    expect(result.rhythmNotes).toBe("段落短促");
    expect(result.stats.totalChars).toBeGreaterThan(0);
  });

  it("uses fallback brief when model returns malformed json", async () => {
    const model = fakeModel("not json at all");

    const result = await runStyleAnalysisPipeline({
      referenceTexts: ["他独自走在山间小路上。雾气弥漫。"],
      model
    });

    expect(result.styleBrief).toContain("平均句长");
    expect(result.bannedSuggestions).toEqual([]);
  });

  it("filters non-string entries in suggestions arrays", async () => {
    const model = fakeModel(
      '{"styleBrief":"x","bannedSuggestions":["仿佛", 123, null, ""],"preferredSuggestions":["剑光"]}'
    );

    const result = await runStyleAnalysisPipeline({
      referenceTexts: ["参考文本"],
      model
    });

    expect(result.bannedSuggestions).toEqual(["仿佛"]);
    expect(result.preferredSuggestions).toEqual(["剑光"]);
  });

  it("includes project metadata in prompt", async () => {
    const model = fakeModel("{}");

    await runStyleAnalysisPipeline({
      projectTitle: "星辰坠落",
      genre: "科幻",
      referenceTexts: ["参考文本一"],
      model
    });

    const prompt = model.generate.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("星辰坠落");
    expect(prompt).toContain("科幻");
  });

  it("truncates very long reference texts", async () => {
    const model = fakeModel("{}");
    const longText = "甲".repeat(2000);

    await runStyleAnalysisPipeline({
      referenceTexts: [longText],
      model
    });

    const prompt = model.generate.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("...");
    expect(prompt.length).toBeLessThan(longText.length + 1500);
  });

  it("propagates model token counts", async () => {
    const model = fakeModel('{"styleBrief":"x"}');

    const result = await runStyleAnalysisPipeline({
      referenceTexts: ["参考"],
      model
    });

    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });
});
