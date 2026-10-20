import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  createProjectMemory,
  findMemoriesByProject
} from "../../../server/writing-assets";
import { getOrganizationId, isUnauthorizedError } from "../../../server/context";

const MEMORY_STATUSES = ["proposed", "accepted", "rejected", "superseded"] as const;
type MemoryStatus = (typeof MEMORY_STATUSES)[number];

const MEMORY_TYPES = [
  "chapter_summary", "volume_summary", "character_state",
  "world_fact", "hook_status", "style_note", "continuity_note"
] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

const SCOPE_TYPES = [
  "project", "volume", "chapter", "character", "world_item", "plot_thread"
] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];

interface CreateBody {
  projectId?: string;
  memoryType?: MemoryType;
  scopeType?: ScopeType;
  scopeId?: string;
  content?: string;
  contentJson?: Record<string, unknown>;
  sourceChapterId?: string;
  sourceJobId?: string;
  confidence?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const memoryType = searchParams.get("memoryType");

  if (!projectId) {
    return NextResponse.json({ success: false, error: "projectId 必填" }, { status: 400 });
  }
  if (status && !MEMORY_STATUSES.includes(status as MemoryStatus)) {
    return NextResponse.json(
      { success: false, error: `status 必须为 ${MEMORY_STATUSES.join(", ")} 之一` },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const items = await findMemoriesByProject(
      organizationId,
      projectId,
      {
        ...(status ? { status: status as MemoryStatus } : {}),
        ...(memoryType ? { memoryType } : {})
      },
      prisma
    );
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  if (!body.projectId || !body.memoryType || !body.scopeType || !body.content) {
    return NextResponse.json(
      { success: false, error: "projectId、memoryType、scopeType、content 为必填项" },
      { status: 400 }
    );
  }
  if (!MEMORY_TYPES.includes(body.memoryType)) {
    return NextResponse.json({ success: false, error: "memoryType 不合法" }, { status: 400 });
  }
  if (!SCOPE_TYPES.includes(body.scopeType)) {
    return NextResponse.json({ success: false, error: "scopeType 不合法" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();
    const memory = await createProjectMemory({
      organizationId,
      projectId: body.projectId,
      memoryType: body.memoryType,
      scopeType: body.scopeType,
      content: body.content,
      ...(body.scopeId ? { scopeId: body.scopeId } : {}),
      ...(body.contentJson !== undefined
        ? { contentJson: body.contentJson as Parameters<typeof createProjectMemory>[0]["contentJson"] }
        : {}),
      ...(body.sourceChapterId ? { sourceChapterId: body.sourceChapterId } : {}),
      ...(body.sourceJobId ? { sourceJobId: body.sourceJobId } : {}),
      ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: memory }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
