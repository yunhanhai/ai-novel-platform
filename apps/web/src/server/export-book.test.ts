import { describe, expect, it, vi } from "vitest";
import { buildExportFilename, collectProjectForExport, renderPlainText } from "./export-book";

function makePrisma(project: unknown, chapters: unknown[]) {
  return {
    project: { findFirst: vi.fn().mockResolvedValue(project) },
    chapter: { findMany: vi.fn().mockResolvedValue(chapters) }
  } as never;
}

describe("collectProjectForExport", () => {
  it("returns null when the project is missing", async () => {
    const prisma = makePrisma(null, []);
    await expect(
      collectProjectForExport({ organizationId: "org-1", projectId: "p-1", prisma })
    ).resolves.toBeNull();
  });

  it("collects chapters in order and sums word counts", async () => {
    const prisma = makePrisma(
      { title: "长夜", createdBy: { displayName: "林墨" } },
      [
        { chapterNo: 1, title: "开门", content: "正文一", wordCount: 3 },
        { chapterNo: 2, title: "夜行", content: null, wordCount: 5 }
      ]
    );

    const book = await collectProjectForExport({ organizationId: "org-1", projectId: "p-1", prisma });

    expect(book).not.toBeNull();
    expect(book!.title).toBe("长夜");
    expect(book!.author).toBe("林墨");
    expect(book!.chapters).toHaveLength(2);
    expect(book!.chapters[1]!.content).toBe("");
    expect(book!.totalWords).toBe(8);
  });
});

describe("renderPlainText", () => {
  const book = {
    title: "长夜",
    author: "林墨",
    totalWords: 12,
    chapters: [
      { chapterNo: 1, title: "开门", content: "第一行\n第二行", wordCount: 6 },
      { chapterNo: 2, title: "夜行", content: "", wordCount: 6 }
    ]
  };

  it("renders a header, per-chapter headings and word counts", () => {
    const text = renderPlainText(book);

    expect(text).toContain("长夜");
    expect(text).toContain("作者：林墨");
    expect(text).toContain("共 2 章 · 约 12 字");
    expect(text).toContain("第1章 开门");
    expect(text).toContain("第2章 夜行");
    expect(text).toContain("（本章 6 字）");
  });

  it("normalizes newlines to CRLF for Windows editors", () => {
    const text = renderPlainText(book);
    expect(text).toContain("第一行\r\n第二行");
    expect(/[^\r]\n/.test(text)).toBe(false);
  });

  it("tolerates a missing author", () => {
    const text = renderPlainText({ ...book, author: "" });
    expect(text).not.toContain("作者：");
  });
});

describe("buildExportFilename", () => {
  it("strips characters that are illegal in filenames", () => {
    expect(buildExportFilename({ ...{ title: 'a/b:c*d?"e<f>g|h' } } as never)).toBe("a_b_c_d__e_f_g_h.txt");
  });

  it("falls back when the title is blank", () => {
    expect(buildExportFilename({ title: "   " } as never)).toBe("未命名作品.txt");
  });
});
