import { describe, expect, it } from "vitest";
import { detectStyleDrift, type ChapterStatPoint } from "./style-drift-detector";

function point(overrides: Partial<ChapterStatPoint> & { chapterNo: number }): ChapterStatPoint {
  return {
    chapterId: `c${overrides.chapterNo}`,
    sentenceLengthAvg: 12,
    dialogueRatio: 0.3,
    descriptionDensity: 0.5,
    ...overrides
  };
}

describe("style-drift-detector", () => {
  it("returns no drift for stable chapters", () => {
    const stats: ChapterStatPoint[] = [
      point({ chapterNo: 1 }),
      point({ chapterNo: 2 }),
      point({ chapterNo: 3 }),
      point({ chapterNo: 4 })
    ];

    const report = detectStyleDrift(stats);

    expect(report.driftedCount).toBe(0);
    expect(report.totalChecked).toBe(3);
  });

  it("detects sentence length drift", () => {
    const stats: ChapterStatPoint[] = [
      point({ chapterNo: 1, sentenceLengthAvg: 10 }),
      point({ chapterNo: 2, sentenceLengthAvg: 11 }),
      point({ chapterNo: 3, sentenceLengthAvg: 10 }),
      point({ chapterNo: 4, sentenceLengthAvg: 25 })  // 突变
    ];

    const report = detectStyleDrift(stats);

    expect(report.driftedCount).toBe(1);
    const drift = report.chapters[0]!;
    expect(drift.chapterNo).toBe(4);
    expect(drift.flags.some((f) => f.metric === "sentence_length")).toBe(true);
  });

  it("detects dialogue ratio drift", () => {
    const stats: ChapterStatPoint[] = [
      point({ chapterNo: 1, dialogueRatio: 0.3 }),
      point({ chapterNo: 2, dialogueRatio: 0.35 }),
      point({ chapterNo: 3, dialogueRatio: 0.32 }),
      point({ chapterNo: 4, dialogueRatio: 0.85 })  // 突变
    ];

    const report = detectStyleDrift(stats);

    expect(report.driftedCount).toBe(1);
    const flag = report.chapters[0]!.flags.find((f) => f.metric === "dialogue_ratio");
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe("error");
  });

  it("classifies severity by delta magnitude", () => {
    const stats: ChapterStatPoint[] = [
      point({ chapterNo: 1, sentenceLengthAvg: 10 }),
      point({ chapterNo: 2, sentenceLengthAvg: 17 })  // delta 7 → warning
    ];

    const report = detectStyleDrift(stats);

    const flag = report.chapters[0]!.flags.find((f) => f.metric === "sentence_length");
    expect(flag?.severity).toBe("warning");
  });

  it("respects custom window size", () => {
    const stats: ChapterStatPoint[] = [
      point({ chapterNo: 1, sentenceLengthAvg: 10 }),
      point({ chapterNo: 2, sentenceLengthAvg: 20 })
    ];

    const report = detectStyleDrift(stats, { windowSize: 1 });

    expect(report.driftedCount).toBe(1);
    expect(report.chapters[0]!.baseline.sentenceLengthAvg).toBe(10);
  });

  it("skips first chapter (no baseline)", () => {
    const stats: ChapterStatPoint[] = [point({ chapterNo: 1 })];

    const report = detectStyleDrift(stats);

    expect(report.driftedCount).toBe(0);
    expect(report.totalChecked).toBe(0);
  });

  it("orders chapters by chapterNo regardless of input order", () => {
    const stats: ChapterStatPoint[] = [
      point({ chapterNo: 3, sentenceLengthAvg: 25 }),
      point({ chapterNo: 1, sentenceLengthAvg: 10 }),
      point({ chapterNo: 2, sentenceLengthAvg: 11 })
    ];

    const report = detectStyleDrift(stats);

    expect(report.chapters[0]!.chapterNo).toBe(3);
  });

  it("flags multiple metrics in one chapter", () => {
    const stats: ChapterStatPoint[] = [
      point({ chapterNo: 1, sentenceLengthAvg: 10, dialogueRatio: 0.3 }),
      point({ chapterNo: 2, sentenceLengthAvg: 25, dialogueRatio: 0.85 })
    ];

    const report = detectStyleDrift(stats);

    expect(report.chapters[0]!.flags.length).toBe(2);
  });
});
