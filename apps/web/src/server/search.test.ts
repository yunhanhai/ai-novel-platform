import { describe, expect, it, vi } from "vitest";
import { buildSnippet, countMatches, searchChapters } from "./search";

describe("buildSnippet", () => {
  it("returns context around the first match", () => {
    const content = `${"前".repeat(50)}目标词${"后".repeat(50)}`;
    const snippet = buildSnippet(content, "目标词", 10);

    expect(snippet).not.toBeNull();
    expect(snippet!.match).toBe("目标词");
    expect(snippet!.before.endsWith("…")).toBe(false);
    expect(snippet!.before.length).toBe(11);
    expect(snippet!.after.length).toBe(11);
  });

  it("marks truncated edges with an ellipsis", () => {
    const content = `${"前".repeat(50)}目标词${"后".repeat(50)}`;
    const snippet = buildSnippet(content, "目标词", 10)!;
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.after.endsWith("…")).toBe(true);
  });

  it("matches case-insensitively and preserves original casing", () => {
    const snippet = buildSnippet("Hello World", "world", 5)!;
    expect(snippet.match).toBe("World");
  });

  it("returns null when there is no match or empty input", () => {
    expect(buildSnippet("abc", "zzz")).toBeNull();
    expect(buildSnippet("abc", "")).toBeNull();
    expect(buildSnippet("", "abc")).toBeNull();
  });
});

describe("countMatches", () => {
  it("counts non-overlapping occurrences case-insensitively", () => {
    expect(countMatches("abABab", "ab")).toBe(3);
  });

  it("returns 0 for empty query", () => {
    expect(countMatches("abc", "")).toBe(0);
  });
});

describe("searchChapters", () => {
  it("returns hits with snippets and counts", async () => {
    const prisma = {
      chapter: {
        findMany: vi.fn().mockResolvedValue([
          { id: "ch-1", chapterNo: 2, title: "夜行", content: "雨夜赶路，雨声不断。" }
        ])
      }
    } as never;

    const hits = await searchChapters({
      organizationId: "org-1",
      projectId: "p-1",
      query: "雨",
      prisma
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.chapterNo).toBe(2);
    expect(hits[0]!.matchCount).toBe(2);
    expect(hits[0]!.snippet.match).toBe("雨");
  });

  it("skips chapters whose content has no real match (defensive)", async () => {
    const prisma = {
      chapter: { findMany: vi.fn().mockResolvedValue([{ id: "ch-1", chapterNo: 1, title: "空", content: "" }]) }
    } as never;

    const hits = await searchChapters({ organizationId: "org-1", projectId: "p-1", query: "雨", prisma });
    expect(hits).toEqual([]);
  });

  it("returns nothing for a blank query without hitting the database", async () => {
    const findMany = vi.fn();
    const hits = await searchChapters({
      organizationId: "org-1",
      projectId: "p-1",
      query: "   ",
      prisma: { chapter: { findMany } } as never
    });

    expect(hits).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
