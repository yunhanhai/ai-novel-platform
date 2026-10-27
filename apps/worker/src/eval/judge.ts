// LLM-as-judge：成对比较两段正文哪个更好。
//
// 为什么是 pairwise 而不是绝对打分：评审领域的共识是相对判断远比绝对
// 分数稳定（同一文本两次打分可能差 2 分，但 A/B 谁更好很少翻转）。
// 直接服务第二期的 A/B 盲测与回归门禁。
//
// 交换检验（swap test）：LLM 有位置偏好（倾向选前者），所以同一对
// 会以 A/B 与 B/A 两个顺序各评一次；两次结论映射回原位后一致才给
// 确定结论，否则记 unstable 并返回 tie。这是评审可靠性的核心保证，
// 成本 ×2 是值得的。

import { EVAL_RUBRIC, EVAL_RUBRIC_VERSION, type RubricDimension } from "@ai-novel/shared/eval/rubric";

export interface JudgeModel {
  generate(prompt: string, options?: { temperature?: number; maxOutputTokens?: number }): Promise<{ text: string }>;
}

export interface PairwiseJudgement {
  winner: "A" | "B" | "tie";
  perDimension: Record<string, "A" | "B" | "tie">;
  reasons: string[];
  /** 交换检验未通过时为 true：两次结论矛盾，可信度低 */
  unstable: boolean;
  rubricVersion: string;
}

const FALLBACK: PairwiseJudgement = {
  winner: "tie",
  perDimension: {},
  reasons: [],
  unstable: true,
  rubricVersion: EVAL_RUBRIC_VERSION
};

interface RawJudgement {
  winner?: unknown;
  perDimension?: unknown;
  reasons?: unknown;
}

export function buildJudgePrompt(
  rubric: RubricDimension[],
  textA: string,
  textB: string
): string {
  const criteria = rubric
    .map((d) => `- ${d.label}（${d.key}）：${d.description}\n  优：${d.anchor5}\n  劣：${d.anchor1}`)
    .join("\n");

  return `你是苛刻的网文责编。下面是同一章的两个版本（A 与 B），请按评分维度逐项比较哪个更好。

评分维度：
${criteria}

版本 A：
${textA}

版本 B：
${textB}

要求：
- 逐维度给出 "A" 或 "B" 或 "tie"（差距不明显必须 tie，不要强行分高下）
- winner 是综合判断
- reasons 用具体原文证据说明，每条不超过 40 字；没有证据的判断无效

只返回 JSON，不要任何解释：
{
  "winner": "A|B|tie",
  "perDimension": { ${rubric.map((d) => `"${d.key}": "A|B|tie"`).join(", ")} },
  "reasons": ["证据1", "证据2"]
}`;
}

type DimensionVerdict = "A" | "B" | "tie";

export function parseJudgement(text: string, rubric: RubricDimension[]): PairwiseJudgement | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const raw = JSON.parse(match[0]) as RawJudgement;

    const validWinners = new Set(["A", "B", "tie"]);
    const winner = typeof raw.winner === "string" && validWinners.has(raw.winner)
      ? (raw.winner as DimensionVerdict)
      : null;
    if (!winner) return null;

    const perDimension: Record<string, DimensionVerdict> = {};
    for (const dimension of rubric) {
      const value = (raw.perDimension as Record<string, unknown> | undefined)?.[dimension.key];
      perDimension[dimension.key] =
        typeof value === "string" && validWinners.has(value) ? (value as DimensionVerdict) : "tie";
    }

    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 5)
      : [];

    return { winner, perDimension, reasons, unstable: false, rubricVersion: EVAL_RUBRIC_VERSION };
  } catch {
    return null;
  }
}

function flip(verdict: DimensionVerdict): DimensionVerdict {
  if (verdict === "A") return "B";
  if (verdict === "B") return "A";
  return "tie";
}

/**
 * 成对评审（含交换检验）。
 * 返回的 winner 已消除位置偏好；两次结论矛盾时 winner=tie 且 unstable=true。
 */
export function createPairwiseJudge(params: {
  model: JudgeModel;
  rubric?: RubricDimension[];
}) {
  const rubric = params.rubric ?? EVAL_RUBRIC;

  return async function judge(textA: string, textB: string): Promise<PairwiseJudgement> {
    const prompt = buildJudgePrompt(rubric, textA, textB);
    const result = await params.model.generate(prompt, { temperature: 0, maxOutputTokens: 1000 });
    const forward = parseJudgement(result.text, rubric);
    if (!forward) return FALLBACK;

    // 交换顺序再评一次，消除位置偏好
    const swappedPrompt = buildJudgePrompt(rubric, textB, textA);
    const swappedResult = await params.model.generate(swappedPrompt, { temperature: 0, maxOutputTokens: 1000 });
    const swapped = parseJudgement(swappedResult.text, rubric);
    if (!swapped) return { ...forward, unstable: true };

    const flippedWinner = flip(swapped.winner);
    if (flippedWinner !== forward.winner) {
      return { ...forward, winner: "tie", unstable: true };
    }

    return forward;
  };
}
