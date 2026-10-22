import { describe, expect, it, vi } from "vitest";
import {
  listChapterVersions,
  getChapterVersion,
  restoreChapterVersion
} from "./content-versions";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    contentVersion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn()
    },
    chapter: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as unknown as Record<string, unknown> & Parameters<typeof listChapterVersions>[0]["prisma"];

  // 事务 mock：直接把 prisma 自身当作 tx 传给回调
  (prisma as Record<string, unknown>).$transaction = vi.fn(
    async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)
  );

  return prisma;
}

describe("content-versions", () => {
  describe("listChapterVersions", () => {
    it("returns versions ordered by versionNo desc", async () => {
      const prisma = mockPrisma({
        contentVersion: {
          findMany: vi.fn().mockResolvedValue([
            { id: "v3", versionNo: 3 },
            { id: "v2", versionNo: 2 }
          ])
        }
      });

      const result = await listChapterVersions({
        organizationId: "org1",
        chapterId: "c1",
        prisma
      });

      expect(result).toHaveLength(2);
      expect(result[0]!.versionNo).toBe(3);
    });
  });

  describe("getChapterVersion", () => {
    it("returns single version", async () => {
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue({ id: "v1" })
        }
      });
      const result = await getChapterVersion("org1", "v1", prisma);
      expect(result?.id).toBe("v1");
    });
  });

  describe("restoreChapterVersion", () => {
    it("throws when version missing", async () => {
      const prisma = mockPrisma({
        contentVersion: { findFirst: vi.fn().mockResolvedValue(null) }
      });
      await expect(
        restoreChapterVersion({
          organizationId: "org1",
          versionId: "missing",
          updatedById: "u1",
          prisma
        })
      ).rejects.toThrow(/版本不存在/);
    });

    it("snapshots current chapter content before restoring", async () => {
      const create = vi.fn().mockResolvedValue({});
      const update = vi.fn().mockResolvedValue({ id: "c1" });
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({ id: "v2", entityId: "c1", content: "新版本内容" })
            .mockResolvedValueOnce({ versionNo: 2, content: "旧的快照" }),
          create
        },
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: "当前正文" }),
          update
        }
      });

      await restoreChapterVersion({
        organizationId: "org1",
        versionId: "v2",
        updatedById: "u1",
        prisma
      });

      // latest.content !== chapter.content → 创建新版本快照
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          versionNo: 3,
          content: "当前正文",
          source: "MANUAL"
        })
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: expect.objectContaining({ content: "新版本内容" })
      });
    });

    it("skips snapshot when chapter content is empty", async () => {
      const create = vi.fn();
      const update = vi.fn().mockResolvedValue({ id: "c1" });
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: "v1", entityId: "c1", content: "first" }),
          create
        },
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: "" }),
          update
        }
      });

      await restoreChapterVersion({
        organizationId: "org1",
        versionId: "v1",
        updatedById: "u1",
        prisma
      });

      expect(create).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalled();
    });

    it("skips snapshot when current content matches latest version", async () => {
      const create = vi.fn();
      const update = vi.fn().mockResolvedValue({ id: "c1" });
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({ id: "v1", entityId: "c1", content: "older" })
            .mockResolvedValueOnce({ versionNo: 5, content: "same" }),
          create
        },
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: "same" }),
          update
        }
      });

      await restoreChapterVersion({
        organizationId: "org1",
        versionId: "v1",
        updatedById: "u1",
        prisma
      });

      expect(create).not.toHaveBeenCalled();
    });
  });
});
