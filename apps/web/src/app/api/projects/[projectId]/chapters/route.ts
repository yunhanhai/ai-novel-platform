import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { createChapter, findChaptersByProject } from "../../../../../server/chapters";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

interface CreateChapterBody {
  chapterNo?: number;
  title?: string;
  volumeId?: string;
}

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const chapters = await findChaptersByProject(organizationId, projectId, prisma);
    return NextResponse.json({
      success: true,
      data: chapters.map((c) => ({
        id: c.id,
        chapterNo: c.chapterNo,
        title: c.title,
        status: c.status,
        wordCount: c.wordCount,
        content: c.content,
        updatedAt: c.updatedAt.toISOString()
      }))
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const body = (await request.json()) as CreateChapterBody;
  const { chapterNo, title } = body;

  if (chapterNo === undefined || !title) {
    return NextResponse.json(
      { success: false, error: "chapterNo 和 title 为必填项" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(chapterNo) || chapterNo < 1) {
    return NextResponse.json(
      { success: false, error: "chapterNo 必须为正整数" },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const createdById = await getUserId();
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
  const status = /unique|已存在|P2002/i.test(message) ? 409 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}
