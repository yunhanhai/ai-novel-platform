import { describe, expect, it, vi } from "vitest";
import { reorderChapters } from "./chapter-reorder";

function makePrisma() {
  const update = vi.fn().mockResolvedValue({});
  return {
    chapter: {
      findMany: vi.fn(),
      update
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ chapter: { update } })
    )
  } as never;
}

function p(prisma: ReturnType<typeof makePrisma>) {
  return prisma as unknown as {
    chapter: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
}

describe("reorderChapters", () => {
  it("returns 0 for an empty list", async () => {
    const prisma = makePrisma();
    const result = await reorderChapters({
      organizationId: "org-1",
      projectId: "p-1",
      orderedIds: [],
      prisma
    });
    expect(result).toEqual({ reordered: 0 });
    expect(p(prisma).chapter.findMany).not.toHaveBeenCalled();
  });

  it("rejects when any chapter is missing or belongs to another project", async () => {
    const prisma = makePrisma();
    p(prisma).chapter.findMany.mockResolvedValue([{ id: "a" }]);

    await expect(
      reorderChapters({
        organizationId: "org-1",
        projectId: "p-1",
        orderedIds: ["a", "b"],
        prisma
      })
    ).rejects.toThrow("REORDER_CHAPTERS_MISMATCH");
  });

  it("moves chapters to negative numbers first, then writes final numbers", async () => {
    const prisma = makePrisma();
    p(prisma).chapter.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);

    const result = await reorderChapters({
      organizationId: "org-1",
      projectId: "p-1",
      orderedIds: ["c", "a", "b"],
      prisma
    });

    expect(result).toEqual({ reordered: 3 });
    const calls = p(prisma).chapter.update.mock.calls.map(
      (args) => (args[0] as { data: { chapterNo: number } }).data.chapterNo
    );
    // 负数腾挪阶段（-1/-2/-3）+ 回写阶段（1/2/3）
    expect(calls).toEqual([-1, -2, -3, 1, 2, 3]);
  });

  it("supports a custom start number", async () => {
    const prisma = makePrisma();
    p(prisma).chapter.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    await reorderChapters({
      organizationId: "org-1",
      projectId: "p-1",
      orderedIds: ["b", "a"],
      startAt: 10,
      prisma
    });

    const calls = p(prisma).chapter.update.mock.calls.map(
      (args) => (args[0] as { data: { chapterNo: number } }).data.chapterNo
    );
    expect(calls).toEqual([-1, -2, 10, 11]);
  });

  it("scopes the existence check to organization and project", async () => {
    const prisma = makePrisma();
    p(prisma).chapter.findMany.mockResolvedValue([{ id: "a" }]);

    await reorderChapters({
      organizationId: "org-1",
      projectId: "p-1",
      orderedIds: ["a"],
      prisma
    });

    expect(p(prisma).chapter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", projectId: "p-1", deletedAt: null })
      })
    );
  });
});
