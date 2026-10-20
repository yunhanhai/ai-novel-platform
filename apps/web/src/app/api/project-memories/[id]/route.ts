import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { setMemoryStatus } from "../../../../server/writing-assets";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ALLOWED = ["proposed", "accepted", "rejected", "superseded"] as const;
type AllowedStatus = (typeof ALLOWED)[number];

interface PatchBody {
  status?: AllowedStatus;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;
  if (!body.status || !ALLOWED.includes(body.status)) {
    return NextResponse.json(
      { success: false, error: `status 必须为 ${ALLOWED.join(", ")} 之一` },
      { status: 400 }
    );
  }
  try {
    const organizationId = await getOrganizationId();
    const updated = await setMemoryStatus(organizationId, id, body.status, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = await getOrganizationId();
    const result = await setMemoryStatus(organizationId, id, "rejected", prisma);
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
  const isNotFound = /P2025|not found|不存在/i.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "记忆不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
