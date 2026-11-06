import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { requireSession } from "../../../../../server/context";
import {
  getPerformanceTrends,
  normalizePerformanceTrendWindow,
  readPerformanceCostBudgetFromEnv
} from "../../../../../server/performance-trends";
import { getEffectivePerformanceCostBudget } from "../../../../../server/performance-budgets";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { organizationId } = await requireSession();
    const { projectId } = await context.params;
    const url = new URL(request.url);
    const window = normalizePerformanceTrendWindow(url.searchParams.get("window") ?? "30d");

    if (!window) {
      return NextResponse.json(
        { success: false, error: "window 必须为 7d 或 30d" },
        { status: 400 }
      );
    }


    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true }
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "项目不存在" },
        { status: 404 }
      );
    }

    const costBudget = await getEffectivePerformanceCostBudget({
      prisma,
      organizationId,
      projectId,
      fallback: readPerformanceCostBudgetFromEnv()
    });
    const data = await getPerformanceTrends({
      prisma,
      organizationId,
      projectId,
      window,
      costBudget
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return errorResponse("performance-trends", error);
  }
}
