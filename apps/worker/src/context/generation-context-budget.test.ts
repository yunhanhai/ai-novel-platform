import { describe, expect, it } from "vitest";
import { normalizePerformanceBudget } from "@ai-novel/shared/generation/performance";
import { deriveGenerationContextTokenBudget } from "./generation-context-budget";

describe("generation context budget", () => {
  it("allocates progressively larger context windows by quality mode", () => {
    const values = (["fast", "balanced", "deep"] as const).map(qualityMode => deriveGenerationContextTokenBudget({
      qualityMode, budget: normalizePerformanceBudget(qualityMode, undefined)
    }));
    expect(values[0]).toBeLessThan(values[1]!);
    expect(values[1]).toBeLessThan(values[2]!);
  });

  it("reserves prompt overhead and keeps the smallest supported input usable", () => {
    const qualityMode = "fast";
    const value = deriveGenerationContextTokenBudget({ qualityMode, budget: normalizePerformanceBudget(qualityMode, { maxInputTokens: 1000 }) });
    expect(value).toBe(500);
    expect(value).toBeLessThan(1000);
  });
});
