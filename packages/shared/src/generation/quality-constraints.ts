import { computeWordCount } from "./word-count";

export interface QualityConstraints {
  minChars?: number;
  maxChars?: number;
  requiredFacts: string[];
}
export interface QualitySummary {
  passed: boolean;
  charCount: number;
  minChars?: number;
  maxChars?: number;
  lengthPassed: boolean;
  missingFacts: string[];
}

export function parseQualityConstraints(value: unknown): QualityConstraints | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw new Error("质量约束无效：字数须为1至20000的整数，最小值不大于最大值，必含片段最多10条且每条1至100字"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const raw = value as Record<string, unknown>;
  for (const key of ["minChars", "maxChars"] as const) {
    const n = raw[key];
    if (n !== undefined && (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 20000)) return fail();
  }
  const minChars = raw.minChars as number | undefined;
  const maxChars = raw.maxChars as number | undefined;
  if (minChars !== undefined && maxChars !== undefined && minChars > maxChars) return fail();
  const facts = raw.requiredFacts ?? [];
  if (!Array.isArray(facts) || facts.length > 10 || facts.some(fact => typeof fact !== "string" || !fact.trim() || [...fact.trim()].length > 100)) return fail();
  return {
    ...(minChars !== undefined ? { minChars } : {}),
    ...(maxChars !== undefined ? { maxChars } : {}),
    requiredFacts: [...new Set((facts as string[]).map(fact => fact.trim()))]
  };
}

export function formatQualityConstraints(rules: QualityConstraints | undefined): string {
  if (!rules) return "";
  return [
    "【本次正文约束】",
    `正文去除空白后的字数：${rules.minChars ?? 1}至${rules.maxChars ?? 20000}字。请在提交前自行核对，不要把核对过程写入正文。`,
    ...rules.requiredFacts.map(fact => `- 必须以实际情节明确呈现，并在正文保留片段：${fact}`),
    "梗概、计划中的事实必须落实为人物能观察到的动作、物证或对话；正文不能只暗示而省略要求的关键信息。"
  ].join("\n");
}

export function checkQualityConstraints(content: string, rules: QualityConstraints): QualitySummary {
  const charCount = computeWordCount(content);
  const lengthPassed = (rules.minChars === undefined || charCount >= rules.minChars) && (rules.maxChars === undefined || charCount <= rules.maxChars);
  const missingFacts = rules.requiredFacts.filter(fact => !content.includes(fact));
  return { passed: lengthPassed && missingFacts.length === 0, charCount,
    ...(rules.minChars !== undefined ? { minChars: rules.minChars } : {}),
    ...(rules.maxChars !== undefined ? { maxChars: rules.maxChars } : {}), lengthPassed, missingFacts };
}
