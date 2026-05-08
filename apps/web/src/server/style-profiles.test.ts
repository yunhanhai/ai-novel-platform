import { describe, expect, it, vi } from "vitest";
import {
  createStyleProfile,
  findStyleProfilesByProject,
  findActiveStyleProfile,
  updateStyleProfile,
  deactivateStyleProfile,
  syncDeslopRulesFromStyleProfile,
  refineStyleProfileFromStats
} from "./style-profiles";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    styleProfile: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    deslopRule: {
      findMany: vi.fn(),
      createMany: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof createStyleProfile>[0]["prisma"];
}

describe("style-profiles", () => {
  describe("createStyleProfile", () => {
    it("creates a profile with style brief", async () => {
      const sp = { id: "sp1", name: "冷峻克制", styleBrief: "短句多动词" };
      const prisma = mockPrisma({
        styleProfile: { create: vi.fn().mockResolvedValue(sp) }
      });

      const result = await createStyleProfile({
        organizationId: "org1",
        projectId: "p1",
        name: "冷峻克制",
        styleBrief: "短句多动词",
        prisma
      });

      expect(result.name).toBe("冷峻克制");
    });

    it("persists stats fields when provided", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        styleProfile: {
          create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await createStyleProfile({
        organizationId: "org1",
        projectId: "p1",
        name: "标准",
        stats: {
          sentenceLengthProfile: { avg: 12, min: 5, max: 30, p50: 11, p90: 22 },
          dialogueRatio: 0.3,
          descriptionDensity: 0.5
        },
        prisma
      });

      expect(captured.dialogueRatio).toBe(0.3);
      expect(captured.descriptionDensity).toBe(0.5);
      expect(captured.sentenceLengthProfile).toEqual({ avg: 12, min: 5, max: 30, p50: 11, p90: 22 });
    });

    it("translates Prisma unique error to friendly message", async () => {
      const prisma = mockPrisma({
        styleProfile: {
          create: vi.fn().mockRejectedValue({ code: "P2002" })
        }
      });

      await expect(
        createStyleProfile({
          organizationId: "org1",
          projectId: "p1",
          name: "重复",
          prisma
        })
      ).rejects.toThrow(/已存在/);
    });
  });

  describe("findStyleProfilesByProject", () => {
    it("lists profiles ordered by active first", async () => {
      const prisma = mockPrisma({
        styleProfile: {
          findMany: vi.fn().mockResolvedValue([{ id: "sp1", isActive: true }])
        }
      });

      const result = await findStyleProfilesByProject("org1", "p1", prisma);
      expect(result).toHaveLength(1);
    });
  });

  describe("findActiveStyleProfile", () => {
    it("returns the most recently updated active profile", async () => {
      const prisma = mockPrisma({
        styleProfile: {
          findFirst: vi.fn().mockResolvedValue({ id: "sp1", isActive: true })
        }
      });

      const result = await findActiveStyleProfile("org1", "p1", prisma);
      expect(result?.id).toBe("sp1");
    });

    it("returns null when no active profile exists", async () => {
      const prisma = mockPrisma({
        styleProfile: { findFirst: vi.fn().mockResolvedValue(null) }
      });

      const result = await findActiveStyleProfile("org1", "p1", prisma);
      expect(result).toBeNull();
    });
  });

  describe("updateStyleProfile", () => {
    it("only sends provided fields", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        styleProfile: {
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await updateStyleProfile("org1", "sp1", { bannedWords: ["仿佛"] }, prisma);

      expect(captured.bannedWords).toEqual(["仿佛"]);
      expect(captured.styleBrief).toBeUndefined();
    });
  });

  describe("deactivateStyleProfile", () => {
    it("sets isActive to false", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        styleProfile: {
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await deactivateStyleProfile("org1", "sp1", prisma);
      expect(captured.isActive).toBe(false);
    });
  });

  describe("syncDeslopRulesFromStyleProfile", () => {
    it("creates rules for new banned words and skips existing ones", async () => {
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const prisma = mockPrisma({
        styleProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sp1",
            name: "标准",
            projectId: "p1",
            bannedWords: ["仿佛", "似乎"]
          })
        },
        deslopRule: {
          findMany: vi.fn().mockResolvedValue([{ pattern: "似乎" }]),
          createMany
        }
      });

      const result = await syncDeslopRulesFromStyleProfile("org1", "sp1", prisma);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            pattern: "仿佛",
            category: "style_banned"
          })
        ]
      });
    });

    it("returns zero when no banned words", async () => {
      const prisma = mockPrisma({
        styleProfile: {
          findUnique: vi.fn().mockResolvedValue({ id: "sp1", projectId: "p1", bannedWords: [] })
        }
      });

      const result = await syncDeslopRulesFromStyleProfile("org1", "sp1", prisma);
      expect(result).toEqual({ created: 0, skipped: 0 });
    });

    it("throws when profile is missing", async () => {
      const prisma = mockPrisma({
        styleProfile: { findUnique: vi.fn().mockResolvedValue(null) }
      });

      await expect(syncDeslopRulesFromStyleProfile("org1", "missing", prisma)).rejects.toThrow(
        /不存在/
      );
    });
  });

  describe("refineStyleProfileFromStats", () => {
    it("blends old and new stats with default weight 0.3", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        styleProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sp1",
            sentenceLengthProfile: { avg: 10, min: 5, max: 20, p50: 9, p90: 18 },
            dialogueRatio: 0.3,
            descriptionDensity: 0.5
          }),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await refineStyleProfileFromStats(
        "org1",
        "sp1",
        {
          sentenceLengthProfile: { avg: 20, min: 10, max: 30, p50: 19, p90: 28 },
          dialogueRatio: 0.5,
          descriptionDensity: 0.7
        },
        prisma
      );

      // 0.3 weight: 10*0.7 + 20*0.3 = 13
      const sp = captured.sentenceLengthProfile as { avg: number };
      expect(sp.avg).toBe(13);
      expect(captured.dialogueRatio).toBeCloseTo(0.36, 2);
      expect(captured.descriptionDensity).toBeCloseTo(0.56, 2);
    });

    it("respects custom weight", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        styleProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sp1",
            sentenceLengthProfile: { avg: 10, min: 5, max: 20, p50: 9, p90: 18 },
            dialogueRatio: 0.3,
            descriptionDensity: 0.5
          }),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await refineStyleProfileFromStats(
        "org1",
        "sp1",
        { dialogueRatio: 0.5 },
        prisma,
        { weight: 1.0 }
      );

      // weight 1.0 → 完全采纳新值
      expect(captured.dialogueRatio).toBe(0.5);
    });

    it("uses new value when old field is missing", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        styleProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sp1",
            sentenceLengthProfile: null,
            dialogueRatio: null,
            descriptionDensity: null
          }),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await refineStyleProfileFromStats(
        "org1",
        "sp1",
        {
          sentenceLengthProfile: { avg: 15, min: 5, max: 25, p50: 14, p90: 22 },
          dialogueRatio: 0.4
        },
        prisma
      );

      const sp = captured.sentenceLengthProfile as { avg: number };
      expect(sp.avg).toBe(15);
      expect(captured.dialogueRatio).toBe(0.4);
    });

    it("clamps weight outside 0-1 range", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        styleProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sp1",
            dialogueRatio: 0.3
          }),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await refineStyleProfileFromStats("org1", "sp1", { dialogueRatio: 0.7 }, prisma, { weight: 99 });

      // weight clamped to 1.0
      expect(captured.dialogueRatio).toBe(0.7);
    });

    it("throws when profile missing", async () => {
      const prisma = mockPrisma({
        styleProfile: { findUnique: vi.fn().mockResolvedValue(null) }
      });

      await expect(
        refineStyleProfileFromStats("org1", "missing", { dialogueRatio: 0.5 }, prisma)
      ).rejects.toThrow(/不存在/);
    });

    it("handles Prisma Decimal objects for old values", async () => {
      const captured: Record<string, unknown> = {};
      const decimalLike = { toNumber: () => 0.4 };
      const prisma = mockPrisma({
        styleProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sp1",
            dialogueRatio: decimalLike
          }),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "sp1" });
          })
        }
      });

      await refineStyleProfileFromStats("org1", "sp1", { dialogueRatio: 0.6 }, prisma, { weight: 0.5 });

      expect(captured.dialogueRatio).toBe(0.5);
    });
  });
});
