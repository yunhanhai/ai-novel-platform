import { describe, expect, it } from "vitest";
import { compareStyle } from "./style-comparator";

describe("style-comparator", () => {
  it("returns max score for empty profile constraints", () => {
    const text = "他推开门走了进去。";
    const report = compareStyle(text, {});

    expect(report.overallScore).toBe(100);
    expect(report.issues).toHaveLength(0);
  });

  it("flags banned words with positions", () => {
    const text = "他仿佛看到了什么。她似乎听到了声音。";
    const report = compareStyle(text, { bannedWords: ["仿佛", "似乎"] });

    expect(report.bannedHits.length).toBe(2);
    expect(report.bannedHits[0]!.word).toBe("仿佛");
    expect(report.overallScore).toBeLessThan(100);
  });

  it("warns when sentence length deviates beyond tolerance", () => {
    const longText = "这是一个非常非常冗长的句子用来测试句长偏差检测能力它包含了很多无意义的修饰词。";
    const report = compareStyle(longText, {
      sentenceLengthProfile: { avg: 5 }
    });

    const delta = report.deltas.find((d) => d.metric === "sentence_length_avg");
    expect(delta).toBeDefined();
    expect(delta!.severity).not.toBe("info");
  });

  it("flags dialogue ratio deviation", () => {
    const text = "他独自走在山间。雾气弥漫。月光皎洁。万籁俱寂。";
    const report = compareStyle(text, { dialogueRatio: 0.5 });

    const delta = report.deltas.find((d) => d.metric === "dialogue_ratio");
    expect(delta).toBeDefined();
    expect(delta!.actual).toBe(0);
    expect(Math.abs(delta!.delta)).toBeGreaterThan(0.1);
  });

  it("reports missing preferred words", () => {
    const text = "他走进房间。";
    const report = compareStyle(text, {
      preferredWords: ["江湖", "侠客", "剑气"]
    });

    expect(report.missingPreferred).toEqual(["江湖", "侠客", "剑气"]);
    expect(report.overallScore).toBeLessThan(100);
  });

  it("does not flag preferred words when present", () => {
    const text = "江湖中流传着一个剑气纵横的故事。";
    const report = compareStyle(text, {
      preferredWords: ["江湖", "剑气"]
    });

    expect(report.missingPreferred).toHaveLength(0);
  });

  it("clamps score to 0 when many violations", () => {
    const text = "仿佛似乎大概或许仿佛似乎大概或许仿佛似乎。";
    const report = compareStyle(text, {
      bannedWords: ["仿佛", "似乎", "大概", "或许"]
    });

    expect(report.overallScore).toBe(0);
  });

  it("populates actualStats from analyzer", () => {
    const text = "他推开门走了进去。屋里漆黑一片。";
    const report = compareStyle(text, {});

    expect(report.actualStats.totalChars).toBeGreaterThan(0);
    expect(report.actualStats.sentenceCount).toBe(2);
  });
});
