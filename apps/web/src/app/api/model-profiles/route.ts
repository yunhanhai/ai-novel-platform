import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import {
  createProfile,
  findProfilesByOrganization
} from "../../../server/model-profiles";
import { getOrganizationId, isUnauthorizedError } from "../../../server/context";

const VALID_TASK_TYPES = new Set([
  "default", "generate_chapter", "generate_outline", "deslop",
  "extract_memory", "rewrite", "polish", "review", "continue_chapter"
]);

interface CreateBody {
  providerId?: string;
  name?: string;
  modelName?: string;
  taskType?: string;
  projectId?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectIdParam = searchParams.get("projectId");
  const taskType = searchParams.get("taskType") ?? undefined;

  try {
    const organizationId = await getOrganizationId();
    const filter: { projectId?: string | null; taskType?: string } = {};
    if (projectIdParam !== null) {
      filter.projectId = projectIdParam === "" ? null : projectIdParam;
    }
    if (taskType) filter.taskType = taskType;

    const profiles = await findProfilesByOrganization(organizationId, filter, prisma);
    return NextResponse.json({ success: true, data: profiles });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  const { providerId, name, modelName, taskType, projectId, temperature, topP, maxOutputTokens } = body;

  if (!providerId || !name || !modelName || !taskType) {
    return NextResponse.json(
      { success: false, error: "providerId、name、modelName、taskType 为必填项" },
      { status: 400 }
    );
  }
  if (!VALID_TASK_TYPES.has(taskType)) {
    return NextResponse.json(
      { success: false, error: "taskType 不在允许列表" },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const profile = await createProfile({
      organizationId,
      providerId,
      name,
      modelName,
      taskType,
      ...(projectId ? { projectId } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
      ...(typeof topP === "number" ? { topP } : {}),
      ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: profile }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] model-profiles failed", error);
  return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
}
