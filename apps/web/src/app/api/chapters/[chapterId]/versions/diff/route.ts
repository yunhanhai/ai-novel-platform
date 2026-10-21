import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getChapterVersion } from "../../../../../../server/content-versions";
import { getOrganizationId, isUnauthorizedError } from "../../../../../../server/context";
import { sanitizeServerMessage } from "../../../../../../server/api-errors";
import { diffText, summarizeDiff } from "../../../../../../server/text-diff";

interface RouteContext {
  params: Promise<{ chapterId: string }>;
}

// 对比某个历史版本与当前正文的差异，供回滚前确认改动范围。
export async function GET(request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get("versionId");

  if (!versionId) {
    return NextResponse.json({ success: false, error: "缺少 versionId" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();

    const [version, chapter] = await Promise.all([
      getChapterVersion(organizationId, versionId, prisma),
      prisma.chapter.findFirst({
        where: { id: chapterId, organizationId, deletedAt: null },
        select: { id: true, content: true, wordCount: true }
      })
    ]);

    if (!version) {
      return NextResponse.json({ success: false, error: "版本不存在" }, { status: 404 });
    }
    if (!chapter) {
      return NextResponse.json({ success: false, error: "章节不存在" }, { status: 404 });
    }
    if (version.entityId !== chapterId) {
      return NextResponse.json({ success: false, error: "版本不属于该章节" }, { status: 400 });
    }

    const current = chapter.content ?? "";
    const target = version.content ?? "";
    const segments = diffText(current, target);
    const summary = summarizeDiff(segments);

    return NextResponse.json({
      success: true,
      data: {
        versionId: version.id,
        versionNo: version.versionNo,
        source: version.source,
        createdAt: version.createdAt.toISOString(),
        currentChars: current.length,
        targetChars: target.length,
        summary,
        segments
      }
    });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] chapter version diff failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
