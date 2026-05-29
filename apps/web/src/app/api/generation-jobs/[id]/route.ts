import { NextResponse } from "next/server";
import { prisma, retryFailedJob } from "@ai-novel/db";
import { getOrganizationId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
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
      return NextResponse.json({ success: false, error: "任务不存在" }, { status: 404 });
    }
    const output = isRecord(job.output) ? job.output : {};
    return NextResponse.json({
      success: true,
      data: {
        ...job,
        performanceSummary: output.performanceSummary,
        diagnosticType: output.diagnosticType,
        diagnosticSummary: output.diagnosticSummary
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    if (!isRecord(body) || body.action !== "retry") {
      return NextResponse.json({ success: false, error: "Unsupported generation job action" }, { status: 400 });
    }

    const organizationId = getOrganizationId();
    const result = await retryFailedJob({ organizationId, jobId: id, prisma });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ success: false, error: "任务不存在" }, { status: 404 });
      }
      return NextResponse.json(
        { success: false, error: `任务当前状态 ${result.status ?? "unknown"} 不能重试` },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, data: result.job });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
