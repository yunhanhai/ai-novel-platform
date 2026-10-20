import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../server/context";
import {
  acknowledgeBudgetNotification,
  listBudgetNotifications,
  type BudgetPrismaClient
} from "../../../server/budgets";

const VALID_STATUSES = new Set(["open", "acknowledged"]);

interface PatchBody {
  id?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const limitParam = searchParams.get("limit");

  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ success: false, error: "status 不在允许列表" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();
    const notifications = await listBudgetNotifications({
      organizationId,
      status: status as "open" | "acknowledged" | undefined,
      ...(limitParam !== null ? { limit: Number(limitParam) } : {}),
      prisma: prisma as unknown as BudgetPrismaClient
    });
    return NextResponse.json({ success: true, data: notifications });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as PatchBody;
  if (!body.id) {
    return NextResponse.json({ success: false, error: "id 为必填项" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();
    const notification = await acknowledgeBudgetNotification({
      organizationId,
      id: body.id,
      prisma: prisma as unknown as BudgetPrismaClient
    });
    return NextResponse.json({ success: true, data: notification });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] budget-notifications failed", error);
  const isBadRequest = /必须|范围|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isBadRequest ? message : sanitizeServerMessage(message) },
    { status: isBadRequest ? 400 : 500 }
  );
}
