import type { PerformanceBudget, QualityMode } from "@ai-novel/shared/generation/performance";

const MODE_CONTEXT_RATIO: Record<QualityMode, number> = {
  fast: 0.38,
  balanced: 0.48,
  deep: 0.58
};

const MIN_CONTEXT_TOKENS = 500;
const PROMPT_OVERHEAD_TOKENS = 500;

export function deriveGenerationContextTokenBudget(params: {
  qualityMode: QualityMode;
  budget: PerformanceBudget;
}): number {
  const usableInputTokens = Math.max(MIN_CONTEXT_TOKENS, params.budget.maxInputTokens - PROMPT_OVERHEAD_TOKENS);
  const proportionalBudget = Math.floor(usableInputTokens * MODE_CONTEXT_RATIO[params.qualityMode]);
  return Math.max(MIN_CONTEXT_TOKENS, proportionalBudget);
}
