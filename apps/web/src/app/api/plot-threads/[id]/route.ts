import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { deletePlotThread, updatePlotThread } from "../../../../server/writing-assets";
import { getOrganizationId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  title?: string;
  description?: string;
  threadType?: string;
  status?: "planted" | "progressing" | "deferred" | "resolved" | "abandoned";
  priority?: number;
  expectedPayoffChapterId?: string | null;
  resolvedChapterId?: string | null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;
  try {
    const organizationId = getOrganizationId();
    const updated = await updatePlotThread(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const result = await deletePlotThread(organizationId, id, prisma);
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /P2025|not found|不存在/i.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "伏笔不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
