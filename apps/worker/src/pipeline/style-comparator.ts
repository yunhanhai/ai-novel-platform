// 风格对比器：把章节正文与 style_profile 对照，输出可解释的风格匹配度报告
import { analyzeStyle, type StyleStats } from "./style-analyzer";

export interface StyleProfileLike {
  name?: string;
  styleBrief?: string;
  sentenceLengthProfile?: { avg?: number; min?: number; max?: number; p50?: number; p90?: number } | null;
  dialogueRatio?: number | null;
  descriptionDensity?: number | null;
  bannedWords?: string[] | null;
  preferredWords?: string[] | null;
}

export interface MetricDelta {
  metric: "sentence_length_avg" | "dialogue_ratio" | "description_density";
  expected: number;
  actual: number;
  delta: number;        // actual - expected
  severity: "info" | "warning" | "error";
}

export interface BannedHit {
  word: string;
  position: { start: number; end: number };
}

export interface ComparisonIssue {
  category: "sentence_length" | "dialogue_ratio" | "description_density" | "banned_word" | "missing_preferred";
  severity: "info" | "warning" | "error";
  message: string;
}

export interface ComparisonReport {
  overallScore: number;         // 0-100
  actualStats: StyleStats;
  deltas: MetricDelta[];
  bannedHits: BannedHit[];
  missingPreferred: string[];
  issues: ComparisonIssue[];
}

const SENTENCE_DELTA_TOLERANCE = 5;       // 平均句长容差
const RATIO_DELTA_TOLERANCE = 0.1;        // 比例类容差
const RATIO_DELTA_HARD_LIMIT = 0.25;      // 超过此值视为 error

export function compareStyle(text: string, profile: StyleProfileLike): ComparisonReport {
  const actualStats = analyzeStyle(text);
  const deltas: MetricDelta[] = [];
  const issues: ComparisonIssue[] = [];

  const expectedSentenceAvg = profile.sentenceLengthProfile?.avg;
  if (typeof expectedSentenceAvg === "number" && expectedSentenceAvg > 0) {
    const delta = actualStats.sentenceLengthProfile.avg - expectedSentenceAvg;
    const severity = sentenceLengthSeverity(delta);
    deltas.push({
      metric: "sentence_length_avg",
      expected: expectedSentenceAvg,
      actual: actualStats.sentenceLengthProfile.avg,
      delta,
      severity
    });
    if (severity !== "info") {
      issues.push({
        category: "sentence_length",
        severity,
        message: `平均句长 ${actualStats.sentenceLengthProfile.avg} 字 vs 期望 ${expectedSentenceAvg} 字（偏差 ${delta > 0 ? "+" : ""}${delta}）`
      });
    }
  }

  const expectedDialogue = numberOrNull(profile.dialogueRatio);
  if (expectedDialogue !== null) {
    const delta = round2(actualStats.dialogueRatio - expectedDialogue);
    const severity = ratioSeverity(delta);
    deltas.push({
      metric: "dialogue_ratio",
      expected: expectedDialogue,
      actual: actualStats.dialogueRatio,
      delta,
      severity
    });
    if (severity !== "info") {
      issues.push({
        category: "dialogue_ratio",
        severity,
        message: `对白比例 ${actualStats.dialogueRatio} vs 期望 ${expectedDialogue}（偏差 ${delta > 0 ? "+" : ""}${delta}）`
      });
    }
  }

  const expectedDensity = numberOrNull(profile.descriptionDensity);
  if (expectedDensity !== null) {
    const delta = round2(actualStats.descriptionDensity - expectedDensity);
    const severity = ratioSeverity(delta);
    deltas.push({
      metric: "description_density",
      expected: expectedDensity,
      actual: actualStats.descriptionDensity,
      delta,
      severity
    });
    if (severity !== "info") {
      issues.push({
        category: "description_density",
        severity,
        message: `描写密度 ${actualStats.descriptionDensity} vs 期望 ${expectedDensity}（偏差 ${delta > 0 ? "+" : ""}${delta}）`
      });
    }
  }

  const bannedHits = scanBannedWords(text, profile.bannedWords ?? []);
  for (const hit of bannedHits) {
    issues.push({
      category: "banned_word",
      severity: "error",
      message: `命中禁用词「${hit.word}」于位置 ${hit.position.start}`
    });
  }

  const missingPreferred = findMissingPreferred(text, profile.preferredWords ?? []);
  for (const word of missingPreferred) {
    issues.push({
      category: "missing_preferred",
      severity: "info",
      message: `偏好词「${word}」未出现`
    });
  }

  const overallScore = computeScore(deltas, bannedHits.length, missingPreferred.length);

  return { overallScore, actualStats, deltas, bannedHits, missingPreferred, issues };
}

function sentenceLengthSeverity(delta: number): "info" | "warning" | "error" {
  const abs = Math.abs(delta);
  if (abs <= SENTENCE_DELTA_TOLERANCE) return "info";
  if (abs <= SENTENCE_DELTA_TOLERANCE * 2) return "warning";
  return "error";
}

function ratioSeverity(delta: number): "info" | "warning" | "error" {
  const abs = Math.abs(delta);
  if (abs <= RATIO_DELTA_TOLERANCE) return "info";
  if (abs <= RATIO_DELTA_HARD_LIMIT) return "warning";
  return "error";
}

function scanBannedWords(text: string, banned: string[]): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const word of banned) {
    if (!word) continue;
    let idx = 0;
    while ((idx = text.indexOf(word, idx)) !== -1) {
      hits.push({ word, position: { start: idx, end: idx + word.length } });
      idx += word.length;
    }
  }
  return hits;
}

function findMissingPreferred(text: string, preferred: string[]): string[] {
  return preferred.filter((w) => Boolean(w) && !text.includes(w));
}

function computeScore(deltas: MetricDelta[], bannedCount: number, missingCount: number): number {
  let score = 100;
  for (const d of deltas) {
    if (d.severity === "warning") score -= 8;
    else if (d.severity === "error") score -= 16;
  }
  score -= bannedCount * 10;
  score -= missingCount * 2;
  return Math.max(0, Math.min(100, score));
}

function numberOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (Number.isNaN(value)) return null;
  return value;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
