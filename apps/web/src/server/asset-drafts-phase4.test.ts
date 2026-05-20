import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/model-adapters", () => ({
  resolveModelProfile: vi.fn(),
  createAdapter: vi.fn()
}));

import { draftWorldItems } from "./world-item-drafts";
import { draftOutlineNodes } from "./outline-drafts";
import { draftPlotThreads } from "./plot-thread-drafts";
import { draftStyleProfiles } from "./style-profile-drafts";
import { draftDeslopRules } from "./deslop-rule-drafts";

const originalEnv = { ...process.env };
const ctx = {
  projectId: "p1",
  organizationId: "org-1",
  prisma: {} as unknown as Parameters<typeof draftWorldItems>[1]["prisma"]
};

describe("draftWorldItems (fake)", () => {
  beforeEach(() => { process.env = { ...originalEnv, USE_FAKE_MODEL: "true" }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("produces N fake items with valid itemType", async () => {
    const res = await draftWorldItems({ count: 5 }, ctx);
    expect(res.drafts).toHaveLength(5);
    for (const d of res.drafts) {
      expect(d.name).toBeTruthy();
      expect(["location", "faction", "artifact", "rule", "power_system", "timeline_event", "creature", "other"])
        .toContain(d.itemType);
      expect(d.priority).toBeGreaterThanOrEqual(0);
      expect(d.priority).toBeLessThanOrEqual(10);
    }
  });
});

describe("draftOutlineNodes (fake)", () => {
  beforeEach(() => { process.env = { ...originalEnv, USE_FAKE_MODEL: "true" }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("uses provided level and continues orderIndex from start", async () => {
    const res = await draftOutlineNodes(
      { count: 3, level: "VOLUME", startOrderIndex: 10 },
      ctx
    );
    expect(res.drafts).toHaveLength(3);
    expect(res.drafts.map((d) => d.level)).toEqual(["VOLUME", "VOLUME", "VOLUME"]);
    expect(res.drafts.map((d) => d.orderIndex)).toEqual([10, 11, 12]);
  });

  it("defaults level to CHAPTER and orderIndex to 0", async () => {
    const res = await draftOutlineNodes({ count: 2 }, ctx);
    expect(res.drafts[0]!.level).toBe("CHAPTER");
    expect(res.drafts[0]!.orderIndex).toBe(0);
  });
});

describe("draftPlotThreads (fake)", () => {
  beforeEach(() => { process.env = { ...originalEnv, USE_FAKE_MODEL: "true" }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("produces N fake threads with valid threadType and priority", async () => {
    const res = await draftPlotThreads({ count: 4 }, ctx);
    expect(res.drafts).toHaveLength(4);
    for (const d of res.drafts) {
      expect(d.title).toBeTruthy();
      expect(["main", "side", "foreshadowing", "mystery", "conflict"]).toContain(d.threadType);
      expect(d.priority).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("draftStyleProfiles (fake)", () => {
  beforeEach(() => { process.env = { ...originalEnv, USE_FAKE_MODEL: "true" }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("produces N fake profiles with banned + preferred words", async () => {
    const res = await draftStyleProfiles({ count: 2 }, ctx);
    expect(res.drafts).toHaveLength(2);
    for (const d of res.drafts) {
      expect(d.name).toBeTruthy();
      expect(d.bannedWords.length).toBeGreaterThan(0);
      expect(d.preferredWords.length).toBeGreaterThan(0);
      expect(d.rhythmNotes).toBeTruthy();
    }
  });
});

describe("draftDeslopRules (fake)", () => {
  beforeEach(() => { process.env = { ...originalEnv, USE_FAKE_MODEL: "true" }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("produces N rules with exact_match type and valid category/severity", async () => {
    const res = await draftDeslopRules({ count: 5 }, ctx);
    expect(res.drafts).toHaveLength(5);
    for (const d of res.drafts) {
      expect(d.pattern).toBeTruthy();
      expect(d.ruleType).toBe("exact_match");
      expect(["stock_phrase", "weak_adverb", "abstract_noun_triple", "repetition", "sentence_pattern", "custom"])
        .toContain(d.category);
      expect(["info", "warning", "error"]).toContain(d.severity);
    }
  });
});
