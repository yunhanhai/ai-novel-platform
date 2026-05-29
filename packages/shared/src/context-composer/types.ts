export type ContextBudgetPreset = "compact" | "standard" | "rich";

export interface ContextOptions {
  budgetPreset?: ContextBudgetPreset;
  excludedAssetIds?: unknown[];
  forcedAssetIds?: unknown[];
}

export interface NormalizedContextOptions {
  budgetPreset: ContextBudgetPreset;
  excludedAssetIds: string[];
  forcedAssetIds: string[];
}

export type ContextAssetType =
  | "character"
  | "world_item"
  | "plot_thread"
  | "memory"
  | "style"
  | "methodology";

export interface ContextAsset {
  id: string;
  sourceType: ContextAssetType;
  name: string;
  content: string;
  priority: number;
  reason: string;
  matchedKeywords: string[];
  tokenEstimate: number;
  required?: boolean;
}
