import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/model-adapters", () => ({
  resolveModelProfile: vi.fn(),
  createAdapter: vi.fn()
}));

import { draftCharacters } from "./character-drafts";

const originalEnv = { ...process.env };
const fakePrisma = {} as unknown as Parameters<typeof draftCharacters>[1]["prisma"];

const ctx = {
  projectId: "p1",
  organizationId: "org-1",
  prisma: fakePrisma
};

describe("draftCharacters", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns N fake drafts under USE_FAKE_MODEL with required fields", async () => {
    process.env.USE_FAKE_MODEL = "true";
    const res = await draftCharacters(
      { count: 4, genreTags: ["奇幻"], styleTags: ["热血"] },
      ctx
    );
    expect(res.degraded).toBe(false);
    expect(res.drafts).toHaveLength(4);
    for (const d of res.drafts) {
      expect(d.name).toBeTruthy();
      expect(["protagonist", "antagonist", "supporting", "minor"]).toContain(d.roleType);
      expect(typeof d.personality).toBe("string");
    }
  });

  it("respects count clamp (>10 -> 10)", async () => {
    process.env.USE_FAKE_MODEL = "true";
    const res = await draftCharacters({ count: 99 }, ctx);
    expect(res.drafts).toHaveLength(10);
  });

  it("uses tag suffix in fake names when tags present", async () => {
    process.env.USE_FAKE_MODEL = "true";
    const res = await draftCharacters({ count: 1, genreTags: ["科幻"] }, ctx);
    expect(res.drafts[0]!.name).toContain("科幻");
  });
});
