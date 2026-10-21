import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { updateChapterContent } from "../../../../server/chapters";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ chapterId: string }>;
}

interface PatchBody {
  content?: string;
  title?: string;
  status?: "PLANNED" | "DRAFT" | "REVIEWING" | "FINAL";
  volumeId?: string | null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  try {
    const organizationId = await getOrganizationId();
    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId, deletedAt: null }
    });
    if (!chapter) {
      return NextResponse.json({ success: false, error: "章节不存在" }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      data: {
        id: chapter.id,
        projectId: chapter.projectId,
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        status: chapter.status,
        wordCount: chapter.wordCount,
        content: chapter.content,
        updatedAt: chapter.updatedAt.toISOString()
      }
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  const body = (await request.json()) as PatchBody;

  try {
    const organizationId = await getOrganizationId();
    const updatedById = await getUserId();

    const existing = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "章节不存在" }, { status: 404 });
    }

    if (body.content !== undefined) {
      const wordCount = computeWordCount(body.content);
      await updateChapterContent({
        organizationId,
        chapterId,
        content: body.content,
        wordCount,
        updatedById,
        prisma
      });
    }
    if (body.title !== undefined || body.status !== undefined || body.volumeId !== undefined) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.volumeId !== undefined ? { volumeId: body.volumeId } : {}),
          updatedById
        }
      });
    }

    const fresh = await prisma.chapter.findUnique({ where: { id: chapterId } });
    return NextResponse.json({ success: true, data: fresh });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] chapters/[chapterId] failed", error);
  return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
}
