import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { listChapterVersions } from "../../../../../server/content-versions";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ chapterId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  try {
    const organizationId = await getOrganizationId();
    const versions = await listChapterVersions({ organizationId, chapterId, prisma });
    return NextResponse.json({
      success: true,
      data: versions.map((v) => ({
        id: v.id,
        versionNo: v.versionNo,
        source: v.source,
        generationJobId: v.generationJobId,
        createdAt: v.createdAt.toISOString(),
        title: v.title,
        contentPreview: v.content.slice(0, 200),
        contentLength: v.content.length
      }))
    });
  } catch (error: unknown) {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] chapters/[chapterId]/versions failed", error);
  return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
