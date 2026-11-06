import { errorResponse } from "../../../../server/api-errors";
import { recordAuditLog } from "../../../../server/audit-log";
import { NextResponse } from "next/server";
import { prisma, retryFailedJob } from "@ai-novel/db";
import { getOrganizationId, requireSession } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = await getOrganizationId();
    const job = await prisma.generationJob.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        jobType: true,
        status: true,
        progress: true,
        targetEntityType: true,
        targetEntityId: true,
        errorCode: true,
        errorMessage: true,
        output: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        steps: {
          orderBy: { startedAt: "asc" },
          select: {
            id: true,
            stepKey: true,
            status: true,
            outputPreview: true,
            promptSnapshot: true,
            inputTokens: true,
            outputTokens: true,
            latencyMs: true,
            errorMessage: true,
            startedAt: true,
            finishedAt: true
          }
        }
      }
    });
    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: job });
  } catch (error: unknown) {
    return errorResponse("generation-job", error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { organizationId, userId } = await requireSession();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "retry") {
      return NextResponse.json({ success: false, error: "不支持的任务操作" }, { status: 400 });
    }
    const { id } = await context.params;
    const result = await prisma.$transaction(async (tx) => {
      const retry = await retryFailedJob({ prisma: tx, organizationId, jobId: id });
      if (retry.ok) {
        await recordAuditLog({ prisma: tx, organizationId, actorUserId: userId,
          action: "generation_job.retry", entityType: "generation_job", entityId: id,
          metadata: { resultingStatus: retry.job.status } });
      }
      return retry;
    });
    if (!result.ok) return NextResponse.json({ success: false, error: result.reason === "not_found" ? "任务不存在" : "只能重试失败任务" }, { status: result.reason === "not_found" ? 404 : 409 });
    return NextResponse.json({ success: true, data: result.job });
  } catch (error: unknown) { return errorResponse("generation-job-retry", error); }
}