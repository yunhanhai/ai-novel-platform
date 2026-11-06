import { NextResponse } from "next/server";
import { errorResponse } from "../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { requireSession } from "../../../server/context";
import {
  getPerformanceTrends,
  normalizePerformanceTrendWindow,
  readPerformanceCostBudgetFromEnv
} from "../../../server/performance-trends";
import { getEffectivePerformanceCostBudget } from "../../../server/performance-budgets";

export async function GET(request: Request) {
  try {
    const { organizationId } = await requireSession();
    const url = new URL(request.url);
    const window = normalizePerformanceTrendWindow(url.searchParams.get("window") ?? "30d");

    if (!window) {
      return NextResponse.json(
        { success: false, error: "window 必须为 7d 或 30d" },
        { status: 400 }
      );
    }


    const costBudget = await getEffectivePerformanceCostBudget({
      prisma,
      organizationId,
      fallback: readPerformanceCostBudgetFromEnv()
    });
    const data = await getPerformanceTrends({
      prisma,
      organizationId,
      window,
      costBudget
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return errorResponse("performance-trends", error);
  }
}
