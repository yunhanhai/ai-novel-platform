import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { deactivateDeslopRule, updateDeslopRule } from "../../../../server/deslop-rules";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  pattern?: string;
  severity?: "info" | "warning" | "error";
  suggestion?: string;
  isActive?: boolean;
  category?: string;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;
  try {
    const organizationId = await getOrganizationId();
    const updated = await updateDeslopRule(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = await getOrganizationId();
    const result = await deactivateDeslopRule(organizationId, id, prisma);
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] deslop-rules/[id] failed", error);
  const isNotFound = /P2025|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "规则不存在" : sanitizeServerMessage(message) },
    { status: isNotFound ? 404 : 500 }
  );
}
