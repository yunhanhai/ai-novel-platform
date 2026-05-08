import { describe, expect, it } from "vitest";
import { createProject, findProjectBySlug, findProjectsByOrganization, softDeleteProject, updateProject } from "./projects";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof createProject>[0]["prisma"];
}

const project = {
  id: "p1", organizationId: "org1", title: "My Novel", slug: "my-novel",
  type: "LONG_NOVEL", genre: "奇幻", targetAudience: null, platformTarget: null,
  styleBrief: null, premise: null, sellingPoints: null, targetWordCount: null,
  updateCadence: null, status: "DRAFT", defaultModelProfileId: null, settings: null,
  createdById: "u1", createdAt: new Date(), updatedAt: new Date(), deletedAt: null
};

describe("projects", () => {
  describe("createProject", () => {
    it("creates a project scoped to an organization", async () => {
      const prisma = mockPrisma({ project: { create: vi.fn().mockResolvedValue(project) } });

      const result = await createProject({
        organizationId: "org1", title: "My Novel", slug: "my-novel",
        createdById: "u1", genre: "奇幻", prisma
      });

      expect(result.title).toBe("My Novel");
      expect(result.genre).toBe("奇幻");
    });

    it("throws on duplicate slug within same org", async () => {
      const dupError = new Error("Unique constraint") as Error & { code: string };
      dupError.code = "P2002";
      const prisma = mockPrisma({ project: { create: vi.fn().mockRejectedValue(dupError) } });

      await expect(
        createProject({ organizationId: "org1", title: "X", slug: "dup", createdById: "u1", prisma })
      ).rejects.toThrow("项目标识已被占用");
    });
  });

  describe("findProjectBySlug", () => {
    it("returns project scoped to organization", async () => {
      const prisma = mockPrisma({ project: { findFirst: vi.fn().mockResolvedValue(project) } });

      const result = await findProjectBySlug("org1", "my-novel", prisma);

      expect(result).toBe(project);
    });
  });

  describe("findProjectsByOrganization", () => {
    it("returns active projects only", async () => {
      const prisma = mockPrisma({ project: { findMany: vi.fn().mockResolvedValue([project]) } });

      const result = await findProjectsByOrganization("org1", prisma);

      expect(result).toHaveLength(1);
    });
  });

  describe("softDeleteProject", () => {
    it("sets deletedAt timestamp", async () => {
      const deleted = { ...project, deletedAt: new Date() };
      const prisma = mockPrisma({ project: { update: vi.fn().mockResolvedValue(deleted) } });

      const result = await softDeleteProject("org1", "p1", prisma);

      expect(result.deletedAt).toBeDefined();
    });
  });

  describe("updateProject", () => {
    it("updates mutable fields", async () => {
      const updated = { ...project, title: "New Title", genre: "科幻" };
      const prisma = mockPrisma({ project: { update: vi.fn().mockResolvedValue(updated) } });

      const result = await updateProject("org1", "p1", { title: "New Title", genre: "科幻" }, prisma);

      expect(result.title).toBe("New Title");
    });
  });
});
