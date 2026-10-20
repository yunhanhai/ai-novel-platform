import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import {
  updateProfile,
  softDeleteProfile
} from "../../../../server/model-profiles";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

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
    const organizationId = await getOrganizationId();
    const updated = await updateProfile(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = await getOrganizationId();
    await softDeleteProfile(organizationId, id, prisma);
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
  console.error("[api] model-profiles/[id] failed", error);
  const isNotFound = /P2025|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "模型档案不存在" : sanitizeServerMessage(message) },
    { status: isNotFound ? 404 : 500 }
  );
}
