import { describe, expect, it, vi } from "vitest";
import { findChapterPage, normalizePaging } from "./chapter-paging";

describe("normalizePaging", () => {
  it("defaults to page 1 and size 50", () => {
    expect(normalizePaging(undefined, undefined)).toEqual({ page: 1, pageSize: 50 });
  });

  it("parses string inputs", () => {
    expect(normalizePaging("3", "20")).toEqual({ page: 3, pageSize: 20 });
  });

  it("rejects invalid values and clamps the page size", () => {
    expect(normalizePaging(0, 0)).toEqual({ page: 1, pageSize: 50 });
    expect(normalizePaging(-5, 9999)).toEqual({ page: 1, pageSize: 200 });
    expect(normalizePaging("abc", "xyz")).toEqual({ page: 1, pageSize: 50 });
  });
});

describe("findChapterPage", () => {
  it("returns items with paging metadata", async () => {
    const prisma = {
      chapter: {
        count: vi.fn().mockResolvedValue(120),
        findMany: vi.fn().mockResolvedValue([
          { id: "c1", chapterNo: 51, title: "五十一章", status: "DRAFT", wordCount: 1000, content: "x", updatedAt: new Date() }
        ])
      }
    } as never;

    const result = await findChapterPage({
      organizationId: "org-1",
      projectId: "p-1",
      page: 2,
      pageSize: 50,
      prisma
    });

    expect(result.total).toBe(120);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it("skips to the requested page and scopes by organization", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await findChapterPage({
      organizationId: "org-1",
      projectId: "p-1",
      page: 3,
      pageSize: 20,
      prisma: { chapter: { findMany, count } } as never
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        where: expect.objectContaining({ organizationId: "org-1", projectId: "p-1" })
      })
    );
  });

  it("reports at least one page for an empty project", async () => {
    const result = await findChapterPage({
      organizationId: "org-1",
      projectId: "p-1",
      page: 1,
      pageSize: 50,
      prisma: {
        chapter: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) }
      } as never
    });

    expect(result.totalPages).toBe(1);
  });
});
