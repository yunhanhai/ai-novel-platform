import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { updateChapterContent } from "../../../../server/chapters";
import { getOrganizationId, getUserId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ chapterId: string }>;
}

interface PatchBody {
  content?: string;
  title?: string;
  status?: "PLANNED" | "DRAFT" | "REVIEWING" | "FINAL";
}

export async function GET(_request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  try {
    const organizationId = getOrganizationId();
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
    const organizationId = getOrganizationId();
    const updatedById = getUserId();

    const existing = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "章节不存在" }, { status: 404 });
    }

    if (body.content !== undefined) {
      const wordCount = countWords(body.content);
      await updateChapterContent({
        organizationId,
        chapterId,
        content: body.content,
        wordCount,
        updatedById,
        prisma
      });
    }
    if (body.title !== undefined || body.status !== undefined) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
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

// 中文/英文混合字数统计：CJK 字符按字数；其余按空白分词
function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[一-鿿㐀-䶿]/g)?.length ?? 0;
  const nonCjk = text.replace(/[一-鿿㐀-䶿]/g, " ");
  const words = nonCjk.split(/\s+/).filter(Boolean).length;
  return cjk + words;
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
