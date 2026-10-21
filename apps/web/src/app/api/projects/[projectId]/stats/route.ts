import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { computeProjectStats } from "../../../../../server/project-stats";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const organizationId = await getOrganizationId();
    const stats = await computeProjectStats({ organizationId, projectId, prisma });
    return NextResponse.json({ success: true, data: stats });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] project stats failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
