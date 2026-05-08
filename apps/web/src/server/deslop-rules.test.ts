import { describe, expect, it, vi } from "vitest";
import {
  createDeslopRule,
  findDeslopRulesByProject,
  updateDeslopRule,
  deactivateDeslopRule
} from "./deslop-rules";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    deslopRule: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof createDeslopRule>[0]["prisma"];
}

describe("deslop-rules", () => {
  describe("createDeslopRule", () => {
    it("defaults severity to warning", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        deslopRule: {
          create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "r1" });
          })
        }
      });

      await createDeslopRule({
        organizationId: "org1",
        projectId: "p1",
        ruleType: "exact_match",
        pattern: "仿佛",
        category: "weak_adverb",
        prisma
      });

      expect(captured.severity).toBe("warning");
      expect(captured.pattern).toBe("仿佛");
    });
  });

  describe("findDeslopRulesByProject", () => {
    it("filters by isActive when provided", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = mockPrisma({ deslopRule: { findMany } });

      await findDeslopRulesByProject("org1", "p1", prisma, { isActive: true });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ isActive: true })
      }));
    });
  });

  describe("updateDeslopRule", () => {
    it("only sends provided fields", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        deslopRule: {
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "r1" });
          })
        }
      });

      await updateDeslopRule("org1", "r1", { suggestion: "改写" }, prisma);

      expect(captured.suggestion).toBe("改写");
      expect(captured.pattern).toBeUndefined();
    });
  });

  describe("deactivateDeslopRule", () => {
    it("sets isActive to false", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        deslopRule: {
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "r1" });
          })
        }
      });

      await deactivateDeslopRule("org1", "r1", prisma);
      expect(captured.isActive).toBe(false);
    });
  });
});
