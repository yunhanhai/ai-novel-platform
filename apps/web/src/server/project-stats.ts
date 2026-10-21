import type { PrismaClient } from "@ai-novel/db";

export interface WordBucket {
  label: string;
  count: number;
}

export interface ProjectStats {
  chapterCount: number;
  totalWords: number;
  averageWords: number;
  longestChapter: { title: string; wordCount: number } | null;
  shortestChapter: { title: string; wordCount: number } | null;
  distribution: WordBucket[];
}

const BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "< 1000", min: 0, max: 999 },
  { label: "1000-1999", min: 1000, max: 1999 },
  { label: "2000-2999", min: 2000, max: 2999 },
  { label: "3000-4999", min: 3000, max: 4999 },
  { label: "≥ 5000", min: 5000, max: Number.POSITIVE_INFINITY }
];

interface StatsParams {
  organizationId: string;
  projectId: string;
  prisma: PrismaClient;
}

export async function computeProjectStats({
  organizationId,
  projectId,
  prisma
}: StatsParams): Promise<ProjectStats> {
  const chapters = await prisma.chapter.findMany({
    where: { organizationId, projectId, deletedAt: null },
    select: { title: true, wordCount: true }
  });

  const chapterCount = chapters.length;
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  let longestChapter: ProjectStats["longestChapter"] = null;
  let shortestChapter: ProjectStats["shortestChapter"] = null;
  for (const chapter of chapters) {
    if (!longestChapter || chapter.wordCount > longestChapter.wordCount) {
      longestChapter = { title: chapter.title, wordCount: chapter.wordCount };
    }
    if (!shortestChapter || chapter.wordCount < shortestChapter.wordCount) {
      shortestChapter = { title: chapter.title, wordCount: chapter.wordCount };
    }
  }

  const distribution = BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: chapters.filter((chapter) => chapter.wordCount >= bucket.min && chapter.wordCount <= bucket.max).length
  }));

  return {
    chapterCount,
    totalWords,
    averageWords: chapterCount === 0 ? 0 : Math.round(totalWords / chapterCount),
    longestChapter,
    shortestChapter,
    distribution
  };
}
