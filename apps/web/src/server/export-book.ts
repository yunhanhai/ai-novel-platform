import type { PrismaClient } from "@ai-novel/db";

interface ExportParams {
  organizationId: string;
  projectId: string;
  prisma: PrismaClient;
}

export interface ExportChapter {
  chapterNo: number;
  title: string;
  content: string;
  wordCount: number;
}

export interface ExportBook {
  title: string;
  author: string;
  chapters: ExportChapter[];
  totalWords: number;
}

export async function collectProjectForExport({
  organizationId,
  projectId,
  prisma
}: ExportParams): Promise<ExportBook | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: { title: true, createdBy: { select: { displayName: true } } }
  });
  if (!project) return null;

  const chapters = await prisma.chapter.findMany({
    where: { organizationId, projectId, deletedAt: null },
    orderBy: { chapterNo: "asc" },
    select: { chapterNo: true, title: true, content: true, wordCount: true }
  });

  const exportChapters: ExportChapter[] = chapters.map((chapter) => ({
    chapterNo: chapter.chapterNo,
    title: chapter.title,
    content: chapter.content ?? "",
    wordCount: chapter.wordCount
  }));

  return {
    title: project.title,
    author: project.createdBy?.displayName ?? "",
    chapters: exportChapters,
    totalWords: exportChapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  };
}

// 纯文本导出：标题、作者、字数概览 + 逐章正文。
// 用 CRLF 换行，Windows 记事本打开不会挤成一行。
export function renderPlainText(book: ExportBook): string {
  const separator = "\r\n";
  const lines: string[] = [];

  lines.push(book.title);
  if (book.author) lines.push(`作者：${book.author}`);
  lines.push(`共 ${book.chapters.length} 章 · 约 ${book.totalWords} 字`);
  lines.push("");

  for (const chapter of book.chapters) {
    lines.push(`第${chapter.chapterNo}章 ${chapter.title}`);
    lines.push("");
    if (chapter.content) lines.push(chapter.content.replace(/\r?\n/g, separator));
    lines.push("");
    lines.push(`（本章 ${chapter.wordCount} 字）`);
    lines.push("");
    lines.push("-".repeat(32));
    lines.push("");
  }

  return lines.join(separator);
}

export function buildExportFilename(book: ExportBook): string {
  const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名作品";
  return `${safeTitle}.txt`;
}
