// 风格漂移检测：跨章节统计对比，发现某章风格突变（句长 / 对白比例 / 描写密度）

export interface ChapterStatPoint {
  chapterId: string;
  chapterNo: number;
  sentenceLengthAvg: number;
  dialogueRatio: number;
  descriptionDensity: number;
}

export type DriftMetric = "sentence_length" | "dialogue_ratio" | "description_density";

export interface DriftFlag {
  metric: DriftMetric;
  baseline: number;
  actual: number;
  delta: number;
  severity: "info" | "warning" | "error";
}

export interface ChapterDrift {
  chapterId: string;
  chapterNo: number;
  baseline: { sentenceLengthAvg: number; dialogueRatio: number; descriptionDensity: number };
  flags: DriftFlag[];
}

export interface DriftReport {
  chapters: ChapterDrift[];
  driftedCount: number;
  totalChecked: number;
}

interface DetectOptions {
  windowSize?: number;            // 用前 N 章作为 baseline，默认 3
  sentenceLengthWarn?: number;    // 平均句长偏差告警阈值（绝对字数），默认 5
  sentenceLengthError?: number;   // error 阈值，默认 10
  ratioWarn?: number;             // 比例类告警阈值，默认 0.15
  ratioError?: number;            // 比例类 error 阈值，默认 0.3
}

export function detectStyleDrift(stats: ChapterStatPoint[], options: DetectOptions = {}): DriftReport {
  const opts = withDefaults(options);
  const sorted = [...stats].sort((a, b) => a.chapterNo - b.chapterNo);
  const chapters: ChapterDrift[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const window = sorted.slice(Math.max(0, i - opts.windowSize), i);
    if (window.length === 0) continue;          // 第一章无 baseline，跳过

    const baseline = computeBaseline(window);
    const flags = detectFlags(current, baseline, opts);

    if (flags.length > 0) {
      chapters.push({
        chapterId: current.chapterId,
        chapterNo: current.chapterNo,
        baseline,
        flags
      });
    }
  }

  return {
    chapters,
    driftedCount: chapters.length,
    totalChecked: Math.max(0, sorted.length - 1)
  };
}

function withDefaults(options: DetectOptions): Required<DetectOptions> {
  return {
    windowSize: options.windowSize ?? 3,
    sentenceLengthWarn: options.sentenceLengthWarn ?? 5,
    sentenceLengthError: options.sentenceLengthError ?? 10,
    ratioWarn: options.ratioWarn ?? 0.15,
    ratioError: options.ratioError ?? 0.3
  };
}

function computeBaseline(window: ChapterStatPoint[]): ChapterDrift["baseline"] {
  const len = window.length;
  return {
    sentenceLengthAvg: round2(window.reduce((s, x) => s + x.sentenceLengthAvg, 0) / len),
    dialogueRatio: round2(window.reduce((s, x) => s + x.dialogueRatio, 0) / len),
    descriptionDensity: round2(window.reduce((s, x) => s + x.descriptionDensity, 0) / len)
  };
}

function detectFlags(
  current: ChapterStatPoint,
  baseline: ChapterDrift["baseline"],
  opts: Required<DetectOptions>
): DriftFlag[] {
  const flags: DriftFlag[] = [];

  const sentenceDelta = round2(current.sentenceLengthAvg - baseline.sentenceLengthAvg);
  const sentenceSeverity = severityFor(Math.abs(sentenceDelta), opts.sentenceLengthWarn, opts.sentenceLengthError);
  if (sentenceSeverity !== null) {
    flags.push({
      metric: "sentence_length",
      baseline: baseline.sentenceLengthAvg,
      actual: current.sentenceLengthAvg,
      delta: sentenceDelta,
      severity: sentenceSeverity
    });
  }

  const dialogueDelta = round2(current.dialogueRatio - baseline.dialogueRatio);
  const dialogueSeverity = severityFor(Math.abs(dialogueDelta), opts.ratioWarn, opts.ratioError);
  if (dialogueSeverity !== null) {
    flags.push({
      metric: "dialogue_ratio",
      baseline: baseline.dialogueRatio,
      actual: current.dialogueRatio,
      delta: dialogueDelta,
      severity: dialogueSeverity
    });
  }

  const densityDelta = round2(current.descriptionDensity - baseline.descriptionDensity);
  const densitySeverity = severityFor(Math.abs(densityDelta), opts.ratioWarn, opts.ratioError);
  if (densitySeverity !== null) {
    flags.push({
      metric: "description_density",
      baseline: baseline.descriptionDensity,
      actual: current.descriptionDensity,
      delta: densityDelta,
      severity: densitySeverity
    });
  }

  return flags;
}

function severityFor(absDelta: number, warn: number, err: number): "warning" | "error" | null {
  if (absDelta >= err) return "error";
  if (absDelta >= warn) return "warning";
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
