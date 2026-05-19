import { describe, expect, it, vi } from "vitest";
import {
  createProfile,
  findProfilesByOrganization,
  findProfileById,
  updateProfile,
  softDeleteProfile
} from "./model-profiles";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    modelProfile: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof createProfile>[0]["prisma"];
}

const profile = {
  id: "mpf1",
  organizationId: "org1",
  projectId: null,
  providerId: "mp1",
  name: "默认章节生成档案",
  modelName: "gpt-4o-mini",
  taskType: "generate_chapter",
  temperature: null,
  topP: null,
  maxOutputTokens: null,
  settings: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

describe("model-profiles", () => {
  describe("createProfile", () => {
    it("persists required fields", async () => {
      const createMock = vi.fn().mockResolvedValue(profile);
      const prisma = mockPrisma({ modelProfile: { create: createMock } });

      const result = await createProfile({
        organizationId: "org1",
        providerId: "mp1",
        name: "默认章节生成档案",
        modelName: "gpt-4o-mini",
        taskType: "generate_chapter",
        prisma
      });

      const call = createMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(call.data.organizationId).toBe("org1");
      expect(call.data.providerId).toBe("mp1");
      expect(call.data.taskType).toBe("generate_chapter");
      expect(result.id).toBe("mpf1");
    });

    it("includes projectId and tuning params when provided", async () => {
      const createMock = vi.fn().mockResolvedValue(profile);
      const prisma = mockPrisma({ modelProfile: { create: createMock } });

      await createProfile({
        organizationId: "org1",
        providerId: "mp1",
        name: "项目级 polish",
        modelName: "claude-3-5-sonnet",
        taskType: "polish",
        projectId: "proj-1",
        temperature: 0.7,
        maxOutputTokens: 2048,
        prisma
      });

      const call = createMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(call.data.projectId).toBe("proj-1");
      expect(call.data.temperature).toBe(0.7);
      expect(call.data.maxOutputTokens).toBe(2048);
    });
  });

  describe("findProfilesByOrganization", () => {
    it("scopes by organizationId only when no filter", async () => {
      const findMock = vi.fn().mockResolvedValue([profile]);
      const prisma = mockPrisma({ modelProfile: { findMany: findMock } });

      const result = await findProfilesByOrganization("org1", {}, prisma);

      expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: "org1" }
      }));
      expect(result).toHaveLength(1);
    });

    it("filters by projectId when given", async () => {
      const findMock = vi.fn().mockResolvedValue([]);
      const prisma = mockPrisma({ modelProfile: { findMany: findMock } });

      await findProfilesByOrganization("org1", { projectId: "proj-1" }, prisma);

      expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: "org1", projectId: "proj-1" }
      }));
    });

    it("filters by taskType when given", async () => {
      const findMock = vi.fn().mockResolvedValue([]);
      const prisma = mockPrisma({ modelProfile: { findMany: findMock } });

      await findProfilesByOrganization("org1", { taskType: "deslop" }, prisma);

      expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: "org1", taskType: "deslop" }
      }));
    });
  });

  describe("findProfileById", () => {
    it("delegates to findFirst with org scope", async () => {
      const findMock = vi.fn().mockResolvedValue(profile);
      const prisma = mockPrisma({ modelProfile: { findFirst: findMock } });

      const result = await findProfileById("org1", "mpf1", prisma);

      expect(findMock).toHaveBeenCalledWith({
        where: { id: "mpf1", organizationId: "org1" }
      });
      expect(result?.id).toBe("mpf1");
    });
  });

  describe("updateProfile", () => {
    it("updates tunable fields", async () => {
      const updateMock = vi.fn().mockResolvedValue({ ...profile, temperature: 0.9 });
      const prisma = mockPrisma({ modelProfile: { update: updateMock } });

      const result = await updateProfile("org1", "mpf1", { temperature: 0.9 }, prisma);

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: "mpf1", organizationId: "org1" },
        data: { temperature: 0.9 }
      });
      expect(result.temperature).toBe(0.9);
    });
  });

  describe("softDeleteProfile", () => {
    it("removes the profile row", async () => {
      const deleteMock = vi.fn().mockResolvedValue(profile);
      const prisma = mockPrisma({ modelProfile: { delete: deleteMock } });

      const result = await softDeleteProfile("org1", "mpf1", prisma);

      expect(deleteMock).toHaveBeenCalledWith({
        where: { id: "mpf1", organizationId: "org1" }
      });
      expect(result.id).toBe("mpf1");
    });
  });
});
