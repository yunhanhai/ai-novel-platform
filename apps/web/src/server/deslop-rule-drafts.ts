import {
  appendExtraPrompt,
  extractJsonArray,
  generateAssetDrafts,
  type AssetDraftBaseContext,
  type AssetDraftBaseInput,
  type AssetDraftResult
} from "./asset-drafts";

const TASK_TYPE = "draft_deslop_rule";

const CATEGORIES = [
  "stock_phrase", "weak_adverb", "abstract_noun_triple",
  "repetition", "sentence_pattern", "custom"
] as const;
type Category = (typeof CATEGORIES)[number];

const SEVERITIES = ["info", "warning", "error"] as const;
type Severity = (typeof SEVERITIES)[number];

export interface DeslopRuleDraft {
  pattern: string;
  category: Category;
  severity: Severity;
  suggestion: string;
  ruleType: "exact_match";
}

export interface DeslopRuleDraftInput extends AssetDraftBaseInput {
  projectTitle?: string;
  genreTags?: string[];
  styleTags?: string[];
  existingPatterns?: string[];
  focusCategory?: Category;
}

export async function draftDeslopRules(
  input: DeslopRuleDraftInput,
  ctx: AssetDraftBaseContext
): Promise<AssetDraftResult<DeslopRuleDraft>> {
  return generateAssetDrafts<DeslopRuleDraftInput, DeslopRuleDraft>({
    input,
    ctx,
    taskType: TASK_TYPE,
    buildPrompt,
    parseResponse,
    buildFake
  });
}

function buildPrompt(input: DeslopRuleDraftInput): string {
  const parts: string[] = [];
  parts.push(
    `你是去 AI 味顾问。请为这部作品设计 ${input.count} 条「禁用词/句式」规则${
      input.focusCategory ? `，集中在「${labelOfCategory(input.focusCategory)}」` : "（覆盖套话/弱化副词/抽象名词等不同类别）"
    }。每条规则要可以在章节扫描时精确匹配。`
  );
  if (input.projectTitle) parts.push(`作品名：${input.projectTitle}`);
  if (input.genreTags?.length) parts.push(`题材：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`风格：${input.styleTags.join("、")}`);
  if (input.existingPatterns?.length) {
    parts.push(`已有规则模式（请避开重复）：${input.existingPatterns.join("、")}`);
  }
  parts.push(
    [
      "请只输出 JSON 数组，不要 Markdown 或解释。每个元素结构：",
      "{",
      '  "pattern": string,                                              // 待匹配的字面词/短语',
      `  "category": ${CATEGORIES.map((c) => `"${c}"`).join("|")},`,
      `  "severity": ${SEVERITIES.map((s) => `"${s}"`).join("|")},`,
      '  "suggestion": string                                            // 建议替换或删除说明'
      ].join("\n") + "\n}"
  );
  parts.push(appendExtraPrompt(input.extraPrompt).trim());
  return parts.filter(Boolean).join("\n");
}

function parseResponse(text: string): DeslopRuleDraft[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  const out: DeslopRuleDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const pattern = typeof rec.pattern === "string" ? rec.pattern.trim() : "";
    if (!pattern) continue;
    out.push({
      pattern,
      category: isCategory(rec.category) ? rec.category : "custom",
      severity: isSeverity(rec.severity) ? rec.severity : "warning",
      suggestion: typeof rec.suggestion === "string" ? rec.suggestion.trim() : "",
      ruleType: "exact_match"
    });
  }
  return out;
}

function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

function labelOfCategory(c: Category): string {
  const map: Record<Category, string> = {
    stock_phrase: "套话",
    weak_adverb: "弱化副词",
    abstract_noun_triple: "抽象名词三连",
    repetition: "重复用词",
    sentence_pattern: "句式",
    custom: "自定义"
  };
  return map[c];
}

function buildFake(input: DeslopRuleDraftInput): DeslopRuleDraft[] {
  const presets: Array<Omit<DeslopRuleDraft, "pattern">> = [
    { category: "stock_phrase", severity: "warning", suggestion: "改写或删除", ruleType: "exact_match" },
    { category: "weak_adverb", severity: "warning", suggestion: "删除该弱化词", ruleType: "exact_match" },
    { category: "abstract_noun_triple", severity: "info", suggestion: "改用具体名词", ruleType: "exact_match" },
    { category: "repetition", severity: "info", suggestion: "改换近义词", ruleType: "exact_match" }
  ];
  const seedPatterns = [
    "仿佛一切都不再重要", "似乎", "略带", "微微", "无可厚非",
    "毋庸置疑", "毫无疑问", "实在是", "由衷地", "心中暗暗"
  ];
  return Array.from({ length: input.count }, (_, i) => {
    const preset = presets[i % presets.length]!;
    return { ...preset, pattern: seedPatterns[i % seedPatterns.length]! };
  });
}
