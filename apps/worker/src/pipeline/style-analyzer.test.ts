import { describe, expect, it } from "vitest";
import { analyzeStyle, analyzeMultipleTexts } from "./style-analyzer";

describe("style-analyzer", () => {
  describe("analyzeStyle", () => {
    it("returns empty stats for blank text", () => {
      const stats = analyzeStyle("");
      expect(stats.totalChars).toBe(0);
      expect(stats.sentenceCount).toBe(0);
      expect(stats.dialogueRatio).toBe(0);
    });

    it("counts chinese chars and sentences", () => {
      const text = "他推开门走了进去。屋里漆黑一片。他点起一盏油灯。";
      const stats = analyzeStyle(text);

      expect(stats.totalChars).toBeGreaterThan(0);
      expect(stats.sentenceCount).toBe(3);
      expect(stats.paragraphCount).toBe(1);
    });

    it("computes sentence length profile", () => {
      const text = "短句。这是一个稍长的句子。这里是一个更加冗长复杂的句子用于测试统计能力。";
      const stats = analyzeStyle(text);

      expect(stats.sentenceLengthProfile.min).toBeGreaterThanOrEqual(2);
      expect(stats.sentenceLengthProfile.max).toBeGreaterThan(stats.sentenceLengthProfile.min);
      expect(stats.sentenceLengthProfile.avg).toBeGreaterThan(0);
    });

    it("detects dialogue ratio with chinese quotes", () => {
      const text = "他说：“你好。”她回答：“你也好。”他们走开了。";
      const stats = analyzeStyle(text);

      expect(stats.dialogueRatio).toBeGreaterThan(0);
      expect(stats.dialogueRatio).toBeLessThanOrEqual(1);
    });

    it("returns zero dialogue ratio for pure narration", () => {
      const text = "他独自走在山间小路上。雾气弥漫。";
      const stats = analyzeStyle(text);

      expect(stats.dialogueRatio).toBe(0);
    });

    it("detects paragraphs separated by newlines", () => {
      const text = "第一段文字内容。\n\n第二段文字内容。\n\n第三段。";
      const stats = analyzeStyle(text);

      expect(stats.paragraphCount).toBe(3);
    });

    it("computes top words excluding stop chars", () => {
      const text = "陈锋走进房间。陈锋看着窗外。陈锋叹了口气。";
      const stats = analyzeStyle(text);

      const topWord = stats.topWords[0];
      expect(topWord).toBeDefined();
      // 高频词应该是"陈"或"锋"，不应是"了"等虚词
      expect(["陈", "锋"]).toContain(topWord!.word);
    });

    it("description density is between 0 and 1", () => {
      const text = "山峰巍峨耸立，云雾缭绕其间，山间松柏苍翠欲滴，溪水潺潺流淌。";
      const stats = analyzeStyle(text);

      expect(stats.descriptionDensity).toBeGreaterThanOrEqual(0);
      expect(stats.descriptionDensity).toBeLessThanOrEqual(1);
    });
  });

  describe("analyzeMultipleTexts", () => {
    it("returns empty stats for empty list", () => {
      const stats = analyzeMultipleTexts([]);
      expect(stats.totalChars).toBe(0);
    });

    it("delegates to single analyzeStyle for one text", () => {
      const text = "他推开门走了进去。屋里漆黑一片。";
      const single = analyzeStyle(text);
      const multi = analyzeMultipleTexts([text]);

      expect(multi.totalChars).toBe(single.totalChars);
      expect(multi.sentenceCount).toBe(single.sentenceCount);
    });

    it("aggregates char counts across texts", () => {
      const t1 = "第一篇章文本内容。";
      const t2 = "第二篇章不同的内容。";
      const stats = analyzeMultipleTexts([t1, t2]);

      expect(stats.totalChars).toBeGreaterThan(0);
      expect(stats.sentenceCount).toBe(2);
    });

    it("merges top words across texts", () => {
      const t1 = "陈锋走进房间。陈锋叹气。";
      const t2 = "陈锋看天。陈锋低头。";
      const stats = analyzeMultipleTexts([t1, t2]);

      const chenCount = stats.topWords.find((w) => w.word === "陈")?.count ?? 0;
      expect(chenCount).toBeGreaterThanOrEqual(4);
    });
  });
});
