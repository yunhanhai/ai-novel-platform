import { describe, expect, it } from "vitest";
import { normalizePerformanceBudget } from "@ai-novel/shared/generation/performance";
import { deriveGenerationContextTokenBudget } from "./generation-context-budget";

describe("generation context budget", () => {
  it("allocates progressively larger context windows by quality mode", () => {
    const fast = deriveGenerationContextTokenBudget({
      qualityMode: "fast",
      budget: normalizePerformanceBudget("fast", undefined)
    });
    const balanced = deriveGenerationContextTokenBudget({
      qualityMode: "balanced",
      budget: normalizePerformanceBudget("balanced", undefined)
    });
    const deep = deriveGenerationContextTokenBudget({
      qualityMode: "deep",
      budget: normalizePerformanceBudget("deep", undefined)
    });

    expect(fast).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(deep);
  });

  it("respects caller max input tokens and reserves prompt overhead", () => {
    const defaultBudget = deriveGenerationContextTokenBudget({
      qualityMode: "balanced",
      budget: normalizePerformanceBudget("balanced", undefined)
    });
    const constrainedBudget = deriveGenerationContextTokenBudget({
      qualityMode: "balanced",
      budget: normalizePerformanceBudget("balanced", { maxInputTokens: 6000 })
    });

    expect(constrainedBudget).toBeLessThan(defaultBudget);
    expect(constrainedBudget).toBeLessThan(6000);
  });

  it("keeps a minimum usable context window for tiny budgets", () => {
    const budget = deriveGenerationContextTokenBudget({
      qualityMode: "fast",
      budget: normalizePerformanceBudget("fast", { maxInputTokens: 1000 })
    });

    expect(budget).toBeGreaterThanOrEqual(500);
    expect(budget).toBeLessThan(1000);
  });
});
