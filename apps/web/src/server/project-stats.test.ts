import { describe, expect, it, vi } from "vitest";
import { computeProjectStats } from "./project-stats";

function makePrisma(chapters: Array<{ title: string; wordCount: number }>) {
  return { chapter: { findMany: vi.fn().mockResolvedValue(chapters) } } as never;
}

describe("computeProjectStats", () => {
  it("returns zeros for an empty project", async () => {
    const stats = await computeProjectStats({
      organizationId: "org-1",
      projectId: "p-1",
      prisma: makePrisma([])
    });

    expect(stats.chapterCount).toBe(0);
    expect(stats.totalWords).toBe(0);
    expect(stats.averageWords).toBe(0);
    expect(stats.longestChapter).toBeNull();
    expect(stats.distribution.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("computes totals, average and extremes", async () => {
    const stats = await computeProjectStats({
      organizationId: "org-1",
      projectId: "p-1",
      prisma: makePrisma([
        { title: "短章", wordCount: 500 },
        { title: "中章", wordCount: 2500 },
        { title: "长章", wordCount: 6000 }
      ])
    });

    expect(stats.chapterCount).toBe(3);
    expect(stats.totalWords).toBe(9000);
    expect(stats.averageWords).toBe(3000);
    expect(stats.longestChapter!.title).toBe("长章");
    expect(stats.shortestChapter!.title).toBe("短章");
  });

  it("buckets chapter lengths", async () => {
    const stats = await computeProjectStats({
      organizationId: "org-1",
      projectId: "p-1",
      prisma: makePrisma([
        { title: "a", wordCount: 200 },
        { title: "b", wordCount: 1500 },
        { title: "c", wordCount: 2100 },
        { title: "d", wordCount: 4200 },
        { title: "e", wordCount: 8000 }
      ])
    });

    expect(stats.distribution.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1]);
  });

  it("only counts chapters of the given project and organization", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await computeProjectStats({
      organizationId: "org-1",
      projectId: "p-1",
      prisma: { chapter: { findMany } } as never
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", projectId: "p-1" })
      })
    );
  });
});
