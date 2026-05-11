import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { updateOutline } from "../../../../server/outlines";
import { getOrganizationId } from "../../../../server/context";

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
    const organizationId = getOrganizationId();
    const updated = await updateOutline(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    await prisma.outline.delete({
      where: { id, organizationId }
    });
    return NextResponse.json({ success: true, data: { id } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /P2025|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "大纲条目不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
