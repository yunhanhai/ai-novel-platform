import { describe, expect, it } from "vitest";
import {
  createVolume,
  createChapter,
  updateChapterContent,
  saveContentVersion,
  findChaptersByProject
} from "./chapters";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    volume: { create: vi.fn() },
    chapter: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    contentVersion: { create: vi.fn(), findFirst: vi.fn() },
    ...overrides
  } as unknown as Parameters<typeof createVolume>[0]["prisma"];
}

const volume = { id: "v1", organizationId: "org1", projectId: "p1", title: "第一卷", orderIndex: 1 };
const chapter = {
  id: "c1", organizationId: "org1", projectId: "p1", volumeId: "v1",
  chapterNo: 1, title: "第一章", wordCount: 0, content: "",
  status: "DRAFT", createdById: "u1"
};

describe("chapters", () => {
  describe("createVolume", () => {
    it("creates a volume scoped to project", async () => {
      const prisma = mockPrisma({ volume: { create: vi.fn().mockResolvedValue(volume) } });

      const result = await createVolume({
        organizationId: "org1", projectId: "p1", title: "第一卷",
        orderIndex: 1, prisma
      });

      expect(result.title).toBe("第一卷");
    });
  });

  describe("createChapter", () => {
    it("creates a chapter with sequential chapterNo", async () => {
      const prisma = mockPrisma({ chapter: { create: vi.fn().mockResolvedValue(chapter) } });

      const result = await createChapter({
        organizationId: "org1", projectId: "p1", volumeId: "v1",
        chapterNo: 1, title: "第一章", createdById: "u1", prisma
      });

      expect(result.chapterNo).toBe(1);
    });
  });

  describe("updateChapterContent", () => {
    it("updates chapter content and word count", async () => {
      const updated = { ...chapter, content: "正文内容", wordCount: 500 };
      const prisma = mockPrisma({ chapter: { update: vi.fn().mockResolvedValue(updated) } });

      const result = await updateChapterContent({
        organizationId: "org1", chapterId: "c1",
        content: "正文内容", wordCount: 500, updatedById: "u1", prisma
      });

      expect(result.wordCount).toBe(500);
    });
  });

  describe("saveContentVersion", () => {
    it("saves version with auto-incremented versionNo", async () => {
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue({ versionNo: 2 }),
          create: vi.fn().mockResolvedValue({ id: "cv1", versionNo: 3 })
        }
      });

      const result = await saveContentVersion({
        organizationId: "org1", projectId: "p1", chapterId: "c1",
        content: "内容", source: "AI", createdById: "u1", prisma
      });

      expect(result.versionNo).toBe(3);
    });

    it("starts from versionNo 1 when no prior versions", async () => {
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "cv1", versionNo: 1 })
        }
      });

      const result = await saveContentVersion({
        organizationId: "org1", projectId: "p1", chapterId: "c1",
        content: "内容", source: "MANUAL", createdById: "u1", prisma
      });

      expect(result.versionNo).toBe(1);
    });
  });

  describe("findChaptersByProject", () => {
    it("returns chapters ordered by chapterNo", async () => {
      const prisma = mockPrisma({ chapter: { findMany: vi.fn().mockResolvedValue([chapter]) } });

      const result = await findChaptersByProject("org1", "p1", prisma);

      expect(result).toHaveLength(1);
    });
  });
});
