// 风格分析管线：参考文本 → 定量统计 + LLM 定性摘要 + 建议词表
// 第一版用 fake-model 闭环，后续可替换为真实模型。结果可直接喂给 createStyleProfile。

import { analyzeMultipleTexts, type StyleStats } from "./style-analyzer";

interface ModelLike {
  generate: (prompt: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

export interface StyleAnalysisInput {
  projectTitle?: string;
  genre?: string;
  referenceTexts: string[];
  model: ModelLike;
}

export interface StyleAnalysisResult {
  stats: StyleStats;
  styleBrief: string;
  bannedSuggestions: string[];
  preferredSuggestions: string[];
  rhythmNotes?: string;
  rawModelOutput: string;
  inputTokens: number;
  outputTokens: number;
}

interface SummaryJsonShape {
  styleBrief?: unknown;
  bannedSuggestions?: unknown;
  preferredSuggestions?: unknown;
  rhythmNotes?: unknown;
}

export async function runStyleAnalysisPipeline(input: StyleAnalysisInput): Promise<StyleAnalysisResult> {
  if (input.referenceTexts.length === 0) {
    throw new Error("至少需要一段参考文本");
  }

  const stats = analyzeMultipleTexts(input.referenceTexts);
  const prompt = buildSummaryPrompt(input, stats);
  const result = await input.model.generate(prompt);
  const parsed = safeJson<SummaryJsonShape>(result.text);

  return {
    stats,
    styleBrief: asString(parsed?.styleBrief, fallbackBrief(stats)),
    bannedSuggestions: asStringArray(parsed?.bannedSuggestions),
    preferredSuggestions: asStringArray(parsed?.preferredSuggestions),
    rhythmNotes: typeof parsed?.rhythmNotes === "string" ? parsed.rhythmNotes : undefined,
    rawModelOutput: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens
  };
}

function buildSummaryPrompt(input: StyleAnalysisInput, stats: StyleStats): string {
  const meta: string[] = [];
  if (input.projectTitle) meta.push(`作品：${input.projectTitle}`);
  if (input.genre) meta.push(`题材：${input.genre}`);

  const sample = input.referenceTexts.slice(0, 3).map((t, i) => `# 参考文本 ${i + 1}\n${truncate(t, 800)}`).join("\n\n");

  return `你是一位资深小说编辑，请基于以下参考文本提炼作者的写作风格画像。

${meta.join("\n")}

[定量指标]
- 总字数：${stats.totalChars}
- 句子数：${stats.sentenceCount}
- 平均句长：${stats.sentenceLengthProfile.avg} 字
- 对白比例：${stats.dialogueRatio}
- 描写密度：${stats.descriptionDensity}
- 高频词 Top 10：${stats.topWords.slice(0, 10).map((w) => w.word).join(" ")}

${sample}

请以 JSON 输出：
{
  "styleBrief": "200 字以内总结作者的句式、节奏、视角、对白风格",
  "bannedSuggestions": ["建议禁用的 AI 味套话"],
  "preferredSuggestions": ["该作者偏好使用的关键词或句式"],
  "rhythmNotes": "节奏与段落组织的额外说明（可选）"
}`;
}

function fallbackBrief(stats: StyleStats): string {
  const parts: string[] = [];
  parts.push(`平均句长 ${stats.sentenceLengthProfile.avg} 字`);
  if (stats.dialogueRatio > 0.4) parts.push("对白偏多");
  else if (stats.dialogueRatio < 0.15) parts.push("叙述为主");
  if (stats.descriptionDensity > 0.6) parts.push("描写密集");
  else if (stats.descriptionDensity < 0.3) parts.push("节奏紧凑");
  return parts.join("，");
}

function safeJson<T>(text: string): T | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
