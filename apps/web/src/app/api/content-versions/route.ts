import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, getUserId } from "../../../server/context";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";

interface CreateVersionBody {
  chapterId?: string;
  content?: string;
  source?: "MANUAL" | "AI" | "IMPORT";
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateVersionBody;
  if (!body.chapterId || typeof body.content !== "string") {
    return NextResponse.json(
      { success: false, error: "chapterId 和 content 为必填项" },
      { status: 400 }
    );
  }
  try {
    const organizationId = getOrganizationId();
    const userId = getUserId();

    const chapter = await prisma.chapter.findFirst({
      where: { id: body.chapterId, organizationId, deletedAt: null },
      select: { id: true, projectId: true }
    });
    if (!chapter) {
      return NextResponse.json({ success: false, error: "章节不存在" }, { status: 404 });
    }

    const last = await prisma.contentVersion.findFirst({
      where: { entityType: "CHAPTER", entityId: body.chapterId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true }
    });
    const nextVersionNo = (last?.versionNo ?? 0) + 1;

    const version = await prisma.contentVersion.create({
      data: {
        organizationId,
        projectId: chapter.projectId,
        entityType: "CHAPTER",
        entityId: body.chapterId,
        versionNo: nextVersionNo,
        content: body.content,
        source: body.source ?? "MANUAL",
        wordCount: computeWordCount(body.content),
        createdById: userId
      },
      select: { id: true, versionNo: true }
    });

    return NextResponse.json({ success: true, data: version }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
