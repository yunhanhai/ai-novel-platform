import { describe, expect, it } from "vitest";
import { aggregateMetrics, computeTextMetrics } from "./metrics";

describe("computeTextMetrics", () => {
  it("returns zeros for empty input", () => {
    const m = computeTextMetrics("");
    expect(m.charCount).toBe(0);
    expect(m.sentenceCount).toBe(0);
    expect(m.slopPer1kChars).toBe(0);
    expect(m.repeatBigramRate).toBe(0);
  });

  it("counts characters excluding whitespace", () => {
    expect(computeTextMetrics("你好 世界\n再见").charCount).toBe(6);
  });

  it("computes average sentence length and variation", () => {
    // 两句：8 字与 3 字 → 均值 5.5
    const m = computeTextMetrics("他推开门走了进来。她笑了。");
    expect(m.sentenceCount).toBe(2);
    expect(m.avgSentenceLength).toBe(5.5);
    expect(m.sentenceLengthCv).toBeGreaterThan(0);
  });

  it("reports low sentence-length variation for robotic uniform sentences", () => {
    const uniform = computeTextMetrics("甲乙丙丁戊己。庚辛壬癸子丑。寅卯辰巳午未。");
    const varied = computeTextMetrics("甲。乙丙丁戊己庚辛壬癸子丑寅卯。辰。");
    expect(uniform.sentenceLengthCv).toBeLessThan(varied.sentenceLengthCv);
  });

  it("detects dialogue line ratio", () => {
    const m = computeTextMetrics("“你来了。”\n他点点头，没有说话。\n“坐吧。”");
    expect(m.paragraphCount).toBe(3);
    expect(m.dialogueLineRatio).toBeCloseTo(2 / 3, 1);
  });

  it("reuses the deslop scanner for slop density", () => {
    const clean = computeTextMetrics("他推开门，屋里没有人。");
    const sloppy = computeTextMetrics("他似乎仿佛明白了什么，总而言之，一切都在不言中。");
    expect(sloppy.slopPer1kChars).toBeGreaterThan(clean.slopPer1kChars);
  });

  it("flags repeated bigrams (stuttering text)", () => {
    const repetitive = computeTextMetrics("他看着他看着他看着他看着他。");
    const natural = computeTextMetrics("他看了看窗外逐渐暗下来的天色，起身点灯。");
    expect(repetitive.repeatBigramRate).toBeGreaterThan(natural.repeatBigramRate);
  });
});

describe("aggregateMetrics", () => {
  it("averages metrics across samples and skips empty ones", () => {
    const agg = aggregateMetrics([
      computeTextMetrics("他推开门。"),
      computeTextMetrics("她笑了，笑得很轻。"),
      computeTextMetrics("")
    ]);
    expect(agg.sampleCount).toBe(2);
    expect(agg.meanOf("sentenceCount")).toBeGreaterThan(0);
  });

  it("handles an all-empty batch without dividing by zero", () => {
    const agg = aggregateMetrics([computeTextMetrics("")]);
    expect(agg.sampleCount).toBe(0);
    expect(agg.meanOf("avgSentenceLength")).toBe(0);
  });
});
