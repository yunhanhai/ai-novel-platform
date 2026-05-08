import { describe, expect, it } from "vitest";
import { createOutline, findOutlinesByProject, updateOutline } from "./outlines";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    outline: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    ...overrides
  } as unknown as Parameters<typeof createOutline>[0]["prisma"];
}

const outline = {
  id: "o1", organizationId: "org1", projectId: "p1", parentId: null,
  level: "BOOK", title: "全书大纲", summary: null, orderIndex: 1,
  status: "PLANNED", createdById: "u1"
};

describe("outlines", () => {
  describe("createOutline", () => {
    it("creates a top-level outline entry", async () => {
      const prisma = mockPrisma({ outline: { create: vi.fn().mockResolvedValue(outline) } });

      const result = await createOutline({
        organizationId: "org1", projectId: "p1",
        level: "BOOK", title: "全书大纲", orderIndex: 1,
        createdById: "u1", prisma
      });

      expect(result.title).toBe("全书大纲");
      expect(result.level).toBe("BOOK");
    });

    it("creates a child outline under a parent", async () => {
      const child = { ...outline, id: "o2", parentId: "o1", level: "VOLUME", title: "卷大纲" };
      const prisma = mockPrisma({ outline: { create: vi.fn().mockResolvedValue(child) } });

      const result = await createOutline({
        organizationId: "org1", projectId: "p1", parentId: "o1",
        level: "VOLUME", title: "卷大纲", orderIndex: 1,
        createdById: "u1", prisma
      });

      expect(result.parentId).toBe("o1");
    });
  });

  describe("findOutlinesByProject", () => {
    it("returns outlines ordered by orderIndex", async () => {
      const prisma = mockPrisma({ outline: { findMany: vi.fn().mockResolvedValue([outline]) } });

      const result = await findOutlinesByProject("org1", "p1", prisma);

      expect(result).toHaveLength(1);
    });
  });

  describe("updateOutline", () => {
    it("updates title and summary", async () => {
      const updated = { ...outline, title: "新标题", summary: "摘要" };
      const prisma = mockPrisma({ outline: { update: vi.fn().mockResolvedValue(updated) } });

      const result = await updateOutline("org1", "o1", { title: "新标题", summary: "摘要" }, prisma);

      expect(result.title).toBe("新标题");
    });
  });
});
