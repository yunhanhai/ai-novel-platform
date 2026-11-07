import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { prisma, cancelGenerationJob } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 停止任务：排队中的直接取消（worker 不会认领）；
// 运行中的标记为 CANCELLED——批量连更会在下一章开始前检查并安全退出，
// 已发出的模型请求可能完成；最终结果如何保留由各 handler 的取消约定决定。
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const result = await cancelGenerationJob({ jobId: id, organizationId, prisma });
    if (!result.ok) return NextResponse.json(
      { success: false, error: result.reason === "not_found" ? "任务不存在" : "任务已结束，无需停止" },
      { status: result.reason === "not_found" ? 404 : 409 }
    );
    return NextResponse.json({ success: true, data: result.job });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] generation-jobs cancel failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
