import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { updateOutline } from "../../../../server/outlines";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  title?: string;
  summary?: string;
  status?: "PLANNED" | "DRAFTING" | "DONE";
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;
  try {
    const organizationId = await getOrganizationId();
    const updated = await updateOutline(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = await getOrganizationId();
    await prisma.outline.delete({
      where: { id, organizationId }
    });
    return NextResponse.json({ success: true, data: { id } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] outlines/[id] failed", error);
  const isNotFound = /P2025|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "大纲条目不存在" : sanitizeServerMessage(message) },
    { status: isNotFound ? 404 : 500 }
  );
}
