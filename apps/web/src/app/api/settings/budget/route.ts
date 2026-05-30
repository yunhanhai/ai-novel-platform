import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId } from "../../../../server/context";
import {
  getBudgetDashboard,
  upsertBudgetPolicy,
  type BudgetPrismaClient
} from "../../../../server/budgets";

interface BudgetBody {
  projectId?: string | null;
  monthlyBudgetCents?: number;
  monthlyTokenQuota?: number;
  cycleAnchorDay?: number;
  thresholdPercents?: unknown;
}

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
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as BudgetBody;

  if (!isInteger(body.monthlyBudgetCents) || !isInteger(body.monthlyTokenQuota) || !isInteger(body.cycleAnchorDay)) {
    return NextResponse.json(
      { success: false, error: "monthlyBudgetCents、monthlyTokenQuota、cycleAnchorDay 必须为整数" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const policy = await upsertBudgetPolicy({
      organizationId,
      projectId: body.projectId,
      monthlyBudgetCents: body.monthlyBudgetCents,
      monthlyTokenQuota: body.monthlyTokenQuota,
      cycleAnchorDay: body.cycleAnchorDay,
      thresholdPercents: body.thresholdPercents,
      prisma: prisma as unknown as BudgetPrismaClient
    });
    const dashboard = await getBudgetDashboard({
      organizationId,
      projectId: body.projectId,
      prisma: prisma as unknown as BudgetPrismaClient
    });

    return NextResponse.json({ success: true, data: { policy, dashboard } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isBadRequest = /必须|范围/.test(message);
  return NextResponse.json(
    { success: false, error: message },
    { status: isBadRequest ? 400 : 500 }
  );
}
