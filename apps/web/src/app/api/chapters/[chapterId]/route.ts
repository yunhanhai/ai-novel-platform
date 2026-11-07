import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sanitizeServerMessage } from "../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { softDeleteChapter, updateChapterContent } from "../../../../server/chapters";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ chapterId: string }>;
}

interface PatchBody {
  content?: string;
  baseContentHash?: string;
  title?: string;
  status?: "PLANNED" | "DRAFT" | "REVIEWING" | "FINAL";
  volumeId?: string | null;
}

const sha256Hex = (content: string) => createHash("sha256").update(content).digest("hex");

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
        contentHash: sha256Hex(chapter.content ?? ""),
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
  if (body.content !== undefined && (typeof body.content !== "string" || typeof body.baseContentHash !== "string" || !/^[0-9a-f]{64}$/i.test(body.baseContentHash))) {
    return NextResponse.json({ success: false, error: "保存正文需要有效的 baseContentHash" }, { status: 400 });
  }

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

    let savedContent: string | undefined;
    if (body.content !== undefined) {
      const wordCount = computeWordCount(body.content);
      const saved = await updateChapterContent({
        organizationId,
        chapterId,
        content: body.content,
        wordCount,
        updatedById,
        baseContentHash: body.baseContentHash,
        prisma
      });
      savedContent = saved.chapter.content ?? "";
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
    return NextResponse.json({ success: true, data: fresh ? { ...fresh, ...(savedContent !== undefined ? { content: savedContent } : {}), contentHash: sha256Hex(savedContent ?? fresh.content ?? "") } : null });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { chapterId } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const existing = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "章节不存在" }, { status: 404 });
    }

    await softDeleteChapter(organizationId, chapterId, prisma);
    return NextResponse.json({ success: true, data: { id: chapterId } });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    const isNotFound = /P2025|不存在|not found/i.test(message);
    if (!isNotFound) console.error("[api] chapter delete failed", error);
    return NextResponse.json(
      { success: false, error: isNotFound ? "章节不存在" : sanitizeServerMessage(message) },
      { status: isNotFound ? 404 : 500 }
    );
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.message === "CHAPTER_CONTENT_STALE") return NextResponse.json({ success: false, error: "正文已被其他页面或任务更新，请核对后再保存" }, { status: 409 });
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] chapters/[chapterId] failed", error);
  return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
}
