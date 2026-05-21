export type QualityMode = "fast" | "balanced" | "deep";

export interface PerformanceBudget {
  maxModelCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxLatencyMs: number;
}

export interface PerformanceBudgetInput {
  maxModelCalls?: unknown;
  maxInputTokens?: unknown;
  maxOutputTokens?: unknown;
  maxLatencyMs?: unknown;
}

export type BudgetSkipReason =
  | "quality_mode"
  | "budget_model_calls"
  | "budget_input_tokens"
  | "budget_output_tokens"
  | "budget_latency_ms"
  | "missing_input"
  | "not_applicable";

export interface SkippedStepSummary {
  stepKey: string;
  reason: BudgetSkipReason;
}

export interface PerformanceSummary {
  qualityMode: QualityMode;
  budget: PerformanceBudget;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  skippedSteps: SkippedStepSummary[];
}

const DEFAULT_BUDGETS: Record<QualityMode, PerformanceBudget> = {
  fast: { maxModelCalls: 3, maxInputTokens: 12000, maxOutputTokens: 5000, maxLatencyMs: 60000 },
  balanced: { maxModelCalls: 6, maxInputTokens: 30000, maxOutputTokens: 10000, maxLatencyMs: 120000 },
  deep: { maxModelCalls: 8, maxInputTokens: 45000, maxOutputTokens: 14000, maxLatencyMs: 180000 }
};

const LIMITS = {
  maxModelCalls: { min: 1, max: 12 },
  maxInputTokens: { min: 1000, max: 120000 },
  maxOutputTokens: { min: 1000, max: 40000 },
  maxLatencyMs: { min: 10000, max: 600000 }
} as const;

export function normalizeQualityMode(value: unknown): QualityMode {
  return value === "fast" || value === "balanced" || value === "deep" ? value : "balanced";
}

export function normalizePerformanceBudget(
  qualityMode: QualityMode,
  input: PerformanceBudgetInput | undefined
): PerformanceBudget {
  const defaults = DEFAULT_BUDGETS[qualityMode];
  return {
    maxModelCalls: clampInt(input?.maxModelCalls, defaults.maxModelCalls, LIMITS.maxModelCalls),
    maxInputTokens: clampInt(input?.maxInputTokens, defaults.maxInputTokens, LIMITS.maxInputTokens),
    maxOutputTokens: clampInt(input?.maxOutputTokens, defaults.maxOutputTokens, LIMITS.maxOutputTokens),
    maxLatencyMs: clampInt(input?.maxLatencyMs, defaults.maxLatencyMs, LIMITS.maxLatencyMs)
  };
}

export function createPerformanceTracker(params: {
  qualityMode: QualityMode;
  budget: PerformanceBudget;
}) {
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  const skippedSteps: SkippedStepSummary[] = [];

  return {
    canRunModelStep(_stepKey: string, opts: { estimatedInputTokens?: number } = {}):
      | { ok: true }
      | { ok: false; reason: BudgetSkipReason } {
      if (modelCalls >= params.budget.maxModelCalls) return { ok: false, reason: "budget_model_calls" };
      if (inputTokens + (opts.estimatedInputTokens ?? 0) > params.budget.maxInputTokens) {
        return { ok: false, reason: "budget_input_tokens" };
      }
      if (outputTokens >= params.budget.maxOutputTokens) return { ok: false, reason: "budget_output_tokens" };
      if (latencyMs >= params.budget.maxLatencyMs) return { ok: false, reason: "budget_latency_ms" };
      return { ok: true };
    },
    recordModelStep(tokens: { inputTokens: number; outputTokens: number; latencyMs: number }) {
      modelCalls += 1;
      inputTokens += Math.max(0, tokens.inputTokens);
      outputTokens += Math.max(0, tokens.outputTokens);
      latencyMs += Math.max(0, tokens.latencyMs);
    },
    recordSkippedStep(stepKey: string, reason: BudgetSkipReason) {
      skippedSteps.push({ stepKey, reason });
    },
    summary(): PerformanceSummary {
      return {
        qualityMode: params.qualityMode,
        budget: params.budget,
        modelCalls,
        inputTokens,
        outputTokens,
        latencyMs,
        skippedSteps
      };
    }
  };
}

function clampInt(value: unknown, fallback: number, limits: { min: number; max: number }): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(limits.max, Math.max(limits.min, parsed));
}
