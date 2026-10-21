import type { PrismaClient } from "@ai-novel/db";

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  chapterId: string;
  chapterNo: number;
  title: string;
  snippet: SearchSnippet;
  matchCount: number;
}

// 在正文里截取首个匹配位置的前后文，供前端高亮展示。
// 匹配不区分大小写（与查询用的 mode: "insensitive" 保持一致）。
export function buildSnippet(content: string, query: string, radius = 40): SearchSnippet | null {
  if (!content || !query) return null;
  const index = content.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return null;

  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + query.length + radius);
  return {
    before: (start > 0 ? "…" : "") + content.slice(start, index),
    match: content.slice(index, index + query.length),
    after: content.slice(index + query.length, end) + (end < content.length ? "…" : "")
  };
}

export function countMatches(content: string, query: string): number {
  if (!content || !query) return 0;
  const haystack = content.toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  let cursor = haystack.indexOf(needle);
  while (cursor >= 0) {
    count += 1;
    cursor = haystack.indexOf(needle, cursor + needle.length);
  }
  return count;
}

interface SearchParams {
  organizationId: string;
  projectId: string;
  query: string;
  limit?: number;
  prisma: PrismaClient;
}

export async function searchChapters({
  organizationId,
  projectId,
  query,
  limit = 30,
  prisma
}: SearchParams): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const chapters = await prisma.chapter.findMany({
    where: {
      organizationId,
      projectId,
      deletedAt: null,
      content: { contains: trimmed, mode: "insensitive" }
    },
    orderBy: { chapterNo: "asc" },
    take: limit,
    select: { id: true, chapterNo: true, title: true, content: true }
  });

  const hits: SearchHit[] = [];
  for (const chapter of chapters) {
    const snippet = buildSnippet(chapter.content ?? "", trimmed);
    if (!snippet) continue;
    hits.push({
      chapterId: chapter.id,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      snippet,
      matchCount: countMatches(chapter.content ?? "", trimmed)
    });
  }
  return hits;
}
