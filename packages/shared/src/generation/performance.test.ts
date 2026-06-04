import { describe, expect, it } from "vitest";
import {
  createPerformanceTracker,
  normalizePerformanceBudget,
  normalizeQualityMode
} from "./performance";

describe("generation performance options", () => {
  it("defaults to balanced quality mode", () => {
    expect(normalizeQualityMode(undefined)).toBe("balanced");
    expect(normalizeQualityMode("fast")).toBe("fast");
    expect(normalizeQualityMode("deep")).toBe("deep");
    expect(normalizeQualityMode("invalid")).toBe("balanced");
  });

  it("uses mode defaults and clamps caller budgets", () => {
    expect(normalizePerformanceBudget("fast", undefined)).toMatchObject({
      maxModelCalls: 3,
      maxInputTokens: 12000,
      maxOutputTokens: 5000,
      maxLatencyMs: 60000
    });

    expect(normalizePerformanceBudget("balanced", {
      maxModelCalls: 99,
      maxInputTokens: -1,
      maxOutputTokens: 1,
      maxLatencyMs: 1
    })).toEqual({
      maxModelCalls: 12,
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      maxLatencyMs: 10000
    });
  });

  it("tracks calls, tokens, latency, and skipped steps", () => {
    const tracker = createPerformanceTracker({
      qualityMode: "fast",
      budget: normalizePerformanceBudget("fast", { maxModelCalls: 1 })
    });

    expect(tracker.canRunModelStep("draft", { estimatedInputTokens: 10 })).toEqual({ ok: true });
    tracker.recordModelStep({ inputTokens: 12, outputTokens: 20, latencyMs: 30 });

    expect(tracker.canRunModelStep("review", { estimatedInputTokens: 10 })).toEqual({
      ok: false,
      reason: "budget_model_calls"
    });

    tracker.recordSkippedStep("review", "budget_model_calls");
    expect(tracker.summary()).toMatchObject({
      qualityMode: "fast",
      modelCalls: 1,
      inputTokens: 12,
      outputTokens: 20,
      latencyMs: 30,
      skippedSteps: [{ stepKey: "review", reason: "budget_model_calls" }]
    });
  });
});
