import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  updateProfile,
  softDeleteProfile
} from "../../../../server/model-profiles";
import { getOrganizationId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  name?: string;
  modelName?: string;
  taskType?: string;
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
}

const VALID_TASK_TYPES = new Set([
  "default", "generate_chapter", "generate_outline", "deslop",
  "extract_memory", "rewrite", "polish", "review", "continue_chapter"
]);

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;

  if (body.taskType && !VALID_TASK_TYPES.has(body.taskType)) {
    return NextResponse.json(
      { success: false, error: "taskType 不在允许列表" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const updated = await updateProfile(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    await softDeleteProfile(organizationId, id, prisma);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /P2025|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "Profile 不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
