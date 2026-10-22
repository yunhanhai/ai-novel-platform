import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { reorderChapters } from "../../../../../../server/chapter-reorder";
import { getOrganizationId, isUnauthorizedError } from "../../../../../../server/context";
import { sanitizeServerMessage } from "../../../../../../server/api-errors";
import { withVersionRetry } from "../../../../../../server/version-retry";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

interface ReorderBody {
  orderedIds?: unknown;
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const body = (await request.json()) as ReorderBody;

  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json({ success: false, error: "orderedIds 必须为非空数组" }, { status: 400 });
  }
  if (body.orderedIds.length > 500) {
    return NextResponse.json({ success: false, error: "单次最多调整 500 章" }, { status: 400 });
  }
  if (body.orderedIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ success: false, error: "orderedIds 必须全部为字符串" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();
    const result = await withVersionRetry(() =>
      reorderChapters({
        organizationId,
        projectId,
        orderedIds: body.orderedIds as string[],
        prisma
      })
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    if (/REORDER_CHAPTERS_MISMATCH/.test(message)) {
      return NextResponse.json(
        { success: false, error: "部分章节不存在或不属于当前作品" },
        { status: 400 }
      );
    }
    console.error("[api] chapters reorder failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
