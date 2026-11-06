import { createHash } from "node:crypto";
import type { NormalizedContextOptions } from "@ai-novel/shared/context-composer/types";
import type { ContextFingerprint } from "@ai-novel/shared/generation/performance";

export function createContextFingerprint(params: {
  organizationId: string;
  projectId: string;
  chapterId: string;
  prompt: string;
  tokenBudget: number;
  contextOptions: NormalizedContextOptions;
  sourceUpdatedAt?: Date | string | null;
}): ContextFingerprint {
  const contextOptionsHash = hash(JSON.stringify({
    tokenBudget: params.tokenBudget,
    budgetPreset: params.contextOptions.budgetPreset,
    excludedAssetIds: [...params.contextOptions.excludedAssetIds].sort(),
    forcedAssetIds: [...params.contextOptions.forcedAssetIds].sort()
  }));
  const timestamp = params.sourceUpdatedAt ? new Date(params.sourceUpdatedAt).getTime() : 0;
  const sourceUpdatedAt = new Date(Number.isFinite(timestamp) ? timestamp : 0).toISOString();
  return {
    hash: hash(JSON.stringify({ organizationId: params.organizationId, projectId: params.projectId, chapterId: params.chapterId, prompt: params.prompt, contextOptionsHash, sourceUpdatedAt })),
    chapterId: params.chapterId,
    contextOptionsHash,
    sourceUpdatedAt
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function latestContextTimestamp(values: Array<Date | string | null | undefined>): string {
  const latest = values.reduce<number>((max, value) => {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? Math.max(max, time) : max;
  }, 0);
  return new Date(latest).toISOString();
}
