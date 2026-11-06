import { describe, expect, it } from "vitest";
import { createContextFingerprint } from "./context-fingerprint";

const input = {
  organizationId: "org-1", projectId: "project-1", chapterId: "chapter-1", prompt: "正文上下文",
  tokenBudget: 500, contextOptions: { budgetPreset: "compact" as const, forcedAssetIds: ["b", "a"], excludedAssetIds: [] },
  sourceUpdatedAt: new Date("2026-11-07T00:00:00Z")
};

describe("context fingerprint", () => {
  it("is stable for equivalent asset selections and exposes no source text", () => {
    const first = createContextFingerprint(input);
    const second = createContextFingerprint({ ...input, contextOptions: { excludedAssetIds: [], forcedAssetIds: ["a", "b"], budgetPreset: "compact" } });
    expect(first).toEqual(second);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contextOptionsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain(input.prompt);
    expect(first.sourceUpdatedAt).toBe("2026-11-07T00:00:00.000Z");
  });

  it("changes when content, scope, budget or a source revision changes", () => {
    const original = createContextFingerprint(input).hash;
    for (const changed of [
      { ...input, prompt: "修改后的上下文" },
      { ...input, organizationId: "other-org" },
      { ...input, tokenBudget: 600 },
      { ...input, sourceUpdatedAt: new Date("2026-11-08T00:00:00Z") }
    ]) expect(createContextFingerprint(changed).hash).not.toBe(original);
  });
});
