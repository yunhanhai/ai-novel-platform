import { describe, expect, it } from "vitest";
import { createProject, findProjectBySlug, findProjectsByOrganization, softDeleteProject, updateProject } from "./projects";
import { Prisma } from "@ai-novel/db";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const txClient = {
    project: { create: vi.fn() },
    writingMethodology: { create: vi.fn() },
    outline: { createMany: vi.fn() }
  };
  return {
    project: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    writingMethodology: { create: vi.fn() },
    outline: { createMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
    _tx: txClient,
    ...overrides
  } as unknown as Parameters<typeof createProject>[0]["prisma"] & {
    _tx: typeof txClient;
    $transaction: ReturnType<typeof vi.fn>;
  };
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
      const prisma = mockPrisma();
      (prisma._tx.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(project);

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
      const prisma = mockPrisma();
      (prisma._tx.project.create as ReturnType<typeof vi.fn>).mockRejectedValue(dupError);

      await expect(
        createProject({ organizationId: "org1", title: "X", slug: "dup", createdById: "u1", prisma })
      ).rejects.toThrow("项目标识已被占用");
    });

    it("不传 wizard 时只创建 project，不动 methodology/outlines", async () => {
      const prisma = mockPrisma();
      (prisma._tx.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(project);

      await createProject({
        organizationId: "org1", title: "X", slug: "x", createdById: "u1", prisma
      });

      expect(prisma._tx.project.create).toHaveBeenCalledTimes(1);
      expect(prisma._tx.writingMethodology.create).not.toHaveBeenCalled();
      expect(prisma._tx.outline.createMany).not.toHaveBeenCalled();
    });

    it("methodType=none 时不创建 methodology", async () => {
      const prisma = mockPrisma();
      (prisma._tx.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(project);

      await createProject({
        organizationId: "org1", title: "X", slug: "x", createdById: "u1",
        wizard: { methodType: "none" }, prisma
      });

      expect(prisma._tx.writingMethodology.create).not.toHaveBeenCalled();
    });

    it("methodType=three_act 时落库 WritingMethodology 一行（含模板内容）", async () => {
      const prisma = mockPrisma();
      (prisma._tx.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(project);

      await createProject({
        organizationId: "org1", title: "X", slug: "x", createdById: "u1",
        wizard: { methodType: "three_act" }, prisma
      });

      expect(prisma._tx.writingMethodology.create).toHaveBeenCalledTimes(1);
      const args = (prisma._tx.writingMethodology.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(args?.data?.methodType).toBe("three_act");
      expect(args?.data?.projectId).toBe(project.id);
      expect(args?.data?.organizationId).toBe("org1");
      expect(args?.data?.isActive).toBe(true);
      expect(args?.data?.outlineMetadata).toBeDefined();
      expect(args?.data?.reviewCriteria).toBeDefined();
    });

    it("methodType=custom 时落库占位 methodology（无模板字段）", async () => {
      const prisma = mockPrisma();
      (prisma._tx.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(project);

      await createProject({
        organizationId: "org1", title: "X", slug: "x", createdById: "u1",
        wizard: { methodType: "custom" }, prisma
      });

      const args = (prisma._tx.writingMethodology.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(args?.data?.methodType).toBe("custom");
      expect(args?.data?.outlineMetadata).toBe(Prisma.JsonNull);
      expect(args?.data?.reviewCriteria).toBe(Prisma.JsonNull);
    });

    it("有 outlineNodes 时批量落 outlines", async () => {
      const prisma = mockPrisma();
      (prisma._tx.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(project);

      await createProject({
        organizationId: "org1", title: "X", slug: "x", createdById: "u1",
        wizard: {
          outlineNodes: [
            { level: "VOLUME", title: "卷一", summary: "开局", orderIndex: 0 },
            { level: "CHAPTER", title: "第一章", orderIndex: 1 }
          ]
        }, prisma
      });

      expect(prisma._tx.outline.createMany).toHaveBeenCalledTimes(1);
      const args = (prisma._tx.outline.createMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(args?.data).toHaveLength(2);
      expect(args?.data?.[0]?.projectId).toBe(project.id);
      expect(args?.data?.[0]?.level).toBe("VOLUME");
      expect(args?.data?.[0]?.createdById).toBe("u1");
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
