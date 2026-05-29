import { describe, expect, it } from "vitest";
import { normalizeContextOptions, resolveTokenBudget } from "./options";

describe("context composer options", () => {
  it("defaults to standard budget and empty override lists", () => {
    expect(normalizeContextOptions(undefined)).toEqual({
      budgetPreset: "standard",
      excludedAssetIds: [],
      forcedAssetIds: []
    });
  });

  it("drops duplicate and non-string ids", () => {
    expect(normalizeContextOptions({
      budgetPreset: "rich",
      excludedAssetIds: ["a", "a", "", 42],
      forcedAssetIds: ["b", "b", null]
    })).toEqual({
      budgetPreset: "rich",
      excludedAssetIds: ["a"],
      forcedAssetIds: ["b"]
    });
  });

  it("maps budget presets to token budgets", () => {
    expect(resolveTokenBudget("compact")).toBe(2400);
    expect(resolveTokenBudget("standard")).toBe(4000);
    expect(resolveTokenBudget("rich")).toBe(7000);
  });
});
