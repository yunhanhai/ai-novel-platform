import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 停止任务：排队中的直接取消（worker 不会认领）；
// 运行中的标记为 CANCELLED——批量连更会在下一章开始前检查并安全退出，
// 单章任务当前步骤会完成（模型调用无法中断），完成后不再覆盖为已完成之外的状态。
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const job = await prisma.generationJob.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true }
    });
    if (!job) {
      return NextResponse.json({ success: false, error: "任务不存在" }, { status: 404 });
    }
    if (job.status !== "QUEUED" && job.status !== "RUNNING") {
      return NextResponse.json(
        { success: false, error: `任务已是「${job.status}」状态，无需停止` },
        { status: 400 }
      );
    }

    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        errorCode: "CANCELLED_BY_USER",
        errorMessage: "已由用户停止"
      }
    });

    return NextResponse.json({ success: true, data: { id: job.id, status: "CANCELLED" } });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] generation-jobs cancel failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
