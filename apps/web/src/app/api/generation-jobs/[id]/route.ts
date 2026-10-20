import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

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
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] generation-jobs/[id] failed", error);
  return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}