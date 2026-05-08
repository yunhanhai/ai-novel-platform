import { describe, expect, it, vi } from "vitest";
import {
  createMethodology,
  createMethodologyFromTemplate,
  findMethodologiesByProject,
  findActiveMethodology,
  updateMethodology,
  deactivateMethodology
} from "./writing-methodologies";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    writingMethodology: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof createMethodology>[0]["prisma"];
}

describe("writing-methodologies", () => {
  describe("createMethodology", () => {
    it("creates a custom methodology", async () => {
      const m = { id: "m1", name: "我的节奏", methodType: "custom" };
      const prisma = mockPrisma({
        writingMethodology: { create: vi.fn().mockResolvedValue(m) }
      });

      const result = await createMethodology({
        organizationId: "org1",
        projectId: "p1",
        name: "我的节奏",
        methodType: "custom",
        prisma
      });

      expect(result.name).toBe("我的节奏");
    });

    it("translates Prisma unique error to friendly message", async () => {
      const prisma = mockPrisma({
        writingMethodology: {
          create: vi.fn().mockRejectedValue({ code: "P2002" })
        }
      });

      await expect(
        createMethodology({
          organizationId: "org1",
          projectId: "p1",
          name: "重复",
          methodType: "custom",
          prisma
        })
      ).rejects.toThrow(/已存在/);
    });
  });

  describe("createMethodologyFromTemplate", () => {
    it("creates from snowflake template with default name", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        writingMethodology: {
          create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "m1", ...args.data });
          })
        }
      });

      await createMethodologyFromTemplate({
        organizationId: "org1",
        projectId: "p1",
        methodType: "snowflake",
        prisma
      });

      expect(captured.name).toBe("雪花写作法");
      expect(captured.methodType).toBe("snowflake");
      expect(captured.outlineMetadata).toBeDefined();
      expect(captured.reviewCriteria).toBeDefined();
    });

    it("allows overriding the name", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        writingMethodology: {
          create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "m1", ...args.data });
          })
        }
      });

      await createMethodologyFromTemplate({
        organizationId: "org1",
        projectId: "p1",
        methodType: "three_act",
        name: "项目专用三幕",
        prisma
      });

      expect(captured.name).toBe("项目专用三幕");
      expect(captured.methodType).toBe("three_act");
    });

    it("rejects custom type", async () => {
      const prisma = mockPrisma();

      await expect(
        createMethodologyFromTemplate({
          organizationId: "org1",
          projectId: "p1",
          methodType: "custom",
          prisma
        })
      ).rejects.toThrow(/没有内置模板/);
    });
  });

  describe("findMethodologiesByProject", () => {
    it("lists methodologies", async () => {
      const prisma = mockPrisma({
        writingMethodology: {
          findMany: vi.fn().mockResolvedValue([{ id: "m1" }, { id: "m2" }])
        }
      });

      const result = await findMethodologiesByProject("org1", "p1", prisma);
      expect(result).toHaveLength(2);
    });
  });

  describe("findActiveMethodology", () => {
    it("returns the active methodology", async () => {
      const prisma = mockPrisma({
        writingMethodology: {
          findFirst: vi.fn().mockResolvedValue({ id: "m1", isActive: true })
        }
      });

      const result = await findActiveMethodology("org1", "p1", prisma);
      expect(result?.id).toBe("m1");
    });

    it("returns null when none active", async () => {
      const prisma = mockPrisma({
        writingMethodology: { findFirst: vi.fn().mockResolvedValue(null) }
      });

      const result = await findActiveMethodology("org1", "p1", prisma);
      expect(result).toBeNull();
    });
  });

  describe("updateMethodology", () => {
    it("only sends provided fields", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        writingMethodology: {
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "m1" });
          })
        }
      });

      await updateMethodology("org1", "m1", { description: "更新描述" }, prisma);

      expect(captured.description).toBe("更新描述");
      expect(captured.outlineMetadata).toBeUndefined();
    });
  });

  describe("deactivateMethodology", () => {
    it("sets isActive to false", async () => {
      const captured: Record<string, unknown> = {};
      const prisma = mockPrisma({
        writingMethodology: {
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            Object.assign(captured, args.data);
            return Promise.resolve({ id: "m1" });
          })
        }
      });

      await deactivateMethodology("org1", "m1", prisma);
      expect(captured.isActive).toBe(false);
    });
  });
});
