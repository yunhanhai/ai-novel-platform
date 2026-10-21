import type { PrismaClient } from "@ai-novel/db";

interface ListParams {
  organizationId: string;
  projectId: string;
  page: number;
  pageSize: number;
  prisma: PrismaClient;
}

export interface ChapterPage {
  items: Array<{
    id: string;
    chapterNo: number;
    title: string;
    status: string;
    wordCount: number;
    content: string | null;
    updatedAt: Date;
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function normalizePaging(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const parsedPage = typeof page === "number" ? page : Number.parseInt(String(page ?? ""), 10);
  const parsedSize = typeof pageSize === "number" ? pageSize : Number.parseInt(String(pageSize ?? ""), 10);

  const safePage = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const safeSize = Number.isFinite(parsedSize) && parsedSize >= 1 ? Math.min(Math.floor(parsedSize), 200) : 50;

  return { page: safePage, pageSize: safeSize };
}

// 分页取章节列表。长篇小说（几百章）一次性返回全量正文会拖慢侧栏首屏，
// 因此默认只取前 50 章；同时返回总数供前端做"加载更多"。
export async function findChapterPage({
  organizationId,
  projectId,
  page,
  pageSize,
  prisma
}: ListParams): Promise<ChapterPage> {
  const where = { organizationId, projectId, deletedAt: null };

  const [total, items] = await Promise.all([
    prisma.chapter.count({ where }),
    prisma.chapter.findMany({
      where,
      orderBy: { chapterNo: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        chapterNo: true,
        title: true,
        status: true,
        wordCount: true,
        content: true,
        updatedAt: true
      }
    })
  ]);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}
