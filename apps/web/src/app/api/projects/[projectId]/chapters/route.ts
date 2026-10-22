import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { createChapter, findChaptersByProject } from "../../../../../server/chapters";
import { findChapterPage, normalizePaging } from "../../../../../server/chapter-paging";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

interface CreateChapterBody {
  chapterNo?: number;
  title?: string;
  volumeId?: string;
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const { searchParams } = new URL(request.url);
  const wantsPaging = searchParams.has("page") || searchParams.has("pageSize");

  try {
    const organizationId = await getOrganizationId();

    if (!wantsPaging) {
      const chapters = await findChaptersByProject(organizationId, projectId, prisma);
      return NextResponse.json({
        success: true,
        data: chapters.map((c) => ({
          id: c.id,
          chapterNo: c.chapterNo,
          title: c.title,
          status: c.status,
          wordCount: c.wordCount,
          volumeId: c.volumeId,
          content: c.content,
          updatedAt: c.updatedAt.toISOString()
        }))
      });
    }

    const { page, pageSize } = normalizePaging(searchParams.get("page"), searchParams.get("pageSize"));
    const result = await findChapterPage({ organizationId, projectId, page, pageSize, prisma });

    return NextResponse.json({
      success: true,
      data: {
        items: result.items.map((c) => ({
          id: c.id,
          chapterNo: c.chapterNo,
          title: c.title,
          status: c.status,
          wordCount: c.wordCount,
          volumeId: c.volumeId,
          content: c.content,
          updatedAt: c.updatedAt.toISOString()
        })),
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages
      }
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const body = (await request.json()) as CreateChapterBody;
  const { title } = body;

  if (!title) {
    return NextResponse.json(
      { success: false, error: "标题为必填项" },
      { status: 400 }
    );
  }
  if (body.chapterNo !== undefined && (!Number.isInteger(body.chapterNo) || body.chapterNo < 1)) {
    return NextResponse.json(
      { success: false, error: "chapterNo 必须为正整数" },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const createdById = await getUserId();

    // 序号由服务端决定：前端只加载分页后的部分章节，
    // 用「已加载的最大序号 + 1」在超过一页时会与库里已有章节撞号。
    let chapterNo = body.chapterNo;
    if (chapterNo === undefined) {
      const last = await prisma.chapter.findFirst({
        where: { organizationId, projectId, deletedAt: null },
        orderBy: { chapterNo: "desc" },
        select: { chapterNo: true }
      });
      chapterNo = (last?.chapterNo ?? 0) + 1;
    }

    const chapter = await createChapter({
      organizationId,
      projectId,
      chapterNo,
      title,
      createdById,
      ...(body.volumeId ? { volumeId: body.volumeId } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: chapter }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] projects/[projectId]/chapters failed", error);
  const status = /unique|已存在|P2002/i.test(message) ? 409 : 500;
  return NextResponse.json({ success: false, error: status === 500 ? sanitizeServerMessage(message) : message }, { status });
}
