import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId } from "../../../../server/context";
import { getBudgetDashboard, type BudgetPrismaClient } from "../../../../server/budgets";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  try {
    const organizationId = getOrganizationId();
    const dashboard = await getBudgetDashboard({
      organizationId,
      projectId,
      prisma: prisma as unknown as BudgetPrismaClient
    });
    return NextResponse.json({ success: true, data: dashboard });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
