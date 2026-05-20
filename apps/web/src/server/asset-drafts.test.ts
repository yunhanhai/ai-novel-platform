import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/model-adapters", () => ({
  resolveModelProfile: vi.fn(),
  createAdapter: vi.fn()
}));

import {
  appendExtraPrompt,
  clampCount,
  extractJsonArray,
  generateAssetDrafts
} from "./asset-drafts";
import { resolveModelProfile, createAdapter } from "@ai-novel/model-adapters";

const originalEnv = { ...process.env };

const fakePrisma = {} as unknown as Parameters<typeof generateAssetDrafts>[0]["ctx"]["prisma"];

const baseCtx = {
  projectId: "p1",
  organizationId: "org-1",
  prisma: fakePrisma
};

describe("clampCount", () => {
  it("clamps to 1..10", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(1)).toBe(1);
    expect(clampCount(5)).toBe(5);
    expect(clampCount(10)).toBe(10);
    expect(clampCount(99)).toBe(10);
    expect(clampCount(-3)).toBe(1);
  });
  it("falls back to 3 on NaN/invalid", () => {
    expect(clampCount(undefined)).toBe(3);
    expect(clampCount("abc")).toBe(3);
    // null coerces to 0 then clamps to 1 — explicit edge contract
    expect(clampCount(null)).toBe(1);
  });
  it("floors fractional input", () => {
    expect(clampCount(3.7)).toBe(3);
  });
});

describe("appendExtraPrompt", () => {
  it("returns empty when extra missing or whitespace", () => {
    expect(appendExtraPrompt(undefined)).toBe("");
    expect(appendExtraPrompt("")).toBe("");
    expect(appendExtraPrompt("   ")).toBe("");
  });
  it("trims and prefixes label", () => {
    expect(appendExtraPrompt("  要更冷峻  ")).toBe("\n额外要求：要更冷峻");
  });
});

describe("extractJsonArray", () => {
  it("parses bare JSON array", () => {
    expect(extractJsonArray('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it("parses JSON inside markdown code fence", () => {
    expect(extractJsonArray("```json\n[1,2,3]\n```")).toEqual([1, 2, 3]);
  });
  it("falls back to first/last bracket scan", () => {
    expect(extractJsonArray('好的，结果如下：[{"x":"y"}] 完毕')).toEqual([{ x: "y" }]);
  });
  it("returns null when no parseable array", () => {
    expect(extractJsonArray("not json")).toBeNull();
    expect(extractJsonArray('{"obj":1}')).toBeNull();
  });
});

describe("generateAssetDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const buildPrompt = vi.fn().mockReturnValue("PROMPT");
  const buildFake = vi.fn().mockImplementation((input: { count: number }) =>
    Array.from({ length: input.count }, (_, i) => ({ name: `fake-${i + 1}` }))
  );
  const parseResponse = vi.fn();

  it("returns fake drafts (not degraded) under USE_FAKE_MODEL", async () => {
    process.env.USE_FAKE_MODEL = "true";
    const res = await generateAssetDrafts<{ count: number }, { name: string }>({
      input: { count: 2 },
      ctx: baseCtx,
      taskType: "draft_character",
      buildPrompt,
      parseResponse,
      buildFake
    });
    expect(res).toEqual({
      drafts: [{ name: "fake-1" }, { name: "fake-2" }],
      degraded: false
    });
    expect(buildPrompt).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("clamps count before passing to fake builder", async () => {
    process.env.USE_FAKE_MODEL = "true";
    const fakeWatcher = vi.fn().mockReturnValue([]);
    await generateAssetDrafts({
      input: { count: 999 },
      ctx: baseCtx,
      taskType: "draft_character",
      buildPrompt,
      parseResponse,
      buildFake: fakeWatcher
    });
    expect(fakeWatcher).toHaveBeenCalledWith(expect.objectContaining({ count: 10 }));
  });

  it("degrades to fake when ENCRYPTION_KEY missing in real mode", async () => {
    process.env.USE_FAKE_MODEL = "false";
    delete process.env.ENCRYPTION_KEY;
    const res = await generateAssetDrafts({
      input: { count: 1 },
      ctx: baseCtx,
      taskType: "draft_character",
      buildPrompt,
      parseResponse,
      buildFake
    });
    expect(res.degraded).toBe(true);
    expect(res.drafts).toHaveLength(1);
  });

  it("degrades to fake when no ModelProfile resolved", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    (resolveModelProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await generateAssetDrafts({
      input: { count: 1 },
      ctx: baseCtx,
      taskType: "draft_character",
      buildPrompt,
      parseResponse,
      buildFake
    });
    expect(res.degraded).toBe(true);
  });

  it("returns parsed drafts on adapter success", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    (resolveModelProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "USER_KEY", baseUrl: null, encryptedApiKey: "x" },
      modelName: "m"
    });
    (createAdapter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      generate: vi.fn().mockResolvedValue({ text: '[{"name":"AI-Hero"}]', inputTokens: 1, outputTokens: 1 }),
      modelName: "m",
      providerType: "OPENAI_COMPATIBLE"
    });
    const parser = vi.fn().mockReturnValue([{ name: "AI-Hero" }]);
    const res = await generateAssetDrafts({
      input: { count: 1 },
      ctx: baseCtx,
      taskType: "draft_character",
      buildPrompt,
      parseResponse: parser,
      buildFake
    });
    expect(res.degraded).toBe(false);
    expect(res.drafts).toEqual([{ name: "AI-Hero" }]);
    expect(parser).toHaveBeenCalledWith('[{"name":"AI-Hero"}]', expect.objectContaining({ count: 1 }));
  });

  it("degrades to fake when parseResponse returns empty array", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    (resolveModelProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "USER_KEY", baseUrl: null, encryptedApiKey: "x" },
      modelName: "m"
    });
    (createAdapter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      generate: vi.fn().mockResolvedValue({ text: "garbage", inputTokens: 0, outputTokens: 0 }),
      modelName: "m",
      providerType: "OPENAI_COMPATIBLE"
    });
    const res = await generateAssetDrafts({
      input: { count: 2 },
      ctx: baseCtx,
      taskType: "draft_character",
      buildPrompt,
      parseResponse: () => [],
      buildFake
    });
    expect(res.degraded).toBe(true);
    expect(res.drafts).toHaveLength(2);
  });

  it("degrades when parseResponse throws", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    (resolveModelProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "USER_KEY", baseUrl: null, encryptedApiKey: "x" },
      modelName: "m"
    });
    (createAdapter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      generate: vi.fn().mockResolvedValue({ text: "garbage", inputTokens: 0, outputTokens: 0 }),
      modelName: "m",
      providerType: "OPENAI_COMPATIBLE"
    });
    const res = await generateAssetDrafts({
      input: { count: 1 },
      ctx: baseCtx,
      taskType: "draft_character",
      buildPrompt,
      parseResponse: () => {
        throw new Error("parse boom");
      },
      buildFake
    });
    expect(res.degraded).toBe(true);
  });
});
