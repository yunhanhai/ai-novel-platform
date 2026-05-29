import type { ContextBudgetPreset, ContextOptions, NormalizedContextOptions } from "./types";

const PRESETS: Record<ContextBudgetPreset, number> = {
  compact: 2400,
  standard: 4000,
  rich: 7000
};

export function normalizeContextOptions(input: ContextOptions | undefined): NormalizedContextOptions {
  return {
    budgetPreset: isPreset(input?.budgetPreset) ? input.budgetPreset : "standard",
    excludedAssetIds: uniqueStrings(input?.excludedAssetIds),
    forcedAssetIds: uniqueStrings(input?.forcedAssetIds)
  };
}

export function resolveTokenBudget(preset: ContextBudgetPreset): number {
  return PRESETS[preset];
}

function isPreset(value: unknown): value is ContextBudgetPreset {
  return value === "compact" || value === "standard" || value === "rich";
}

function uniqueStrings(values: unknown[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value): value is string => typeof value === "string" && value.length > 0))];
}
