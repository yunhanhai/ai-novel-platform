import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { searchChapters } from "../../../../../server/search";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 30;

  if (!query.trim()) {
    return NextResponse.json({ success: true, data: { query: "", hits: [] } });
  }

  try {
    const organizationId = await getOrganizationId();
    const hits = await searchChapters({ organizationId, projectId, query, limit, prisma });
    return NextResponse.json({ success: true, data: { query: query.trim(), hits } });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] project search failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
