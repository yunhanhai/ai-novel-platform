import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import {
  createOutline,
  findOutlinesByProject
} from "../../../server/outlines";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../server/context";

type OutlineLevel = "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";

interface CreateBody {
  projectId?: string;
  parentId?: string;
  level?: OutlineLevel;
  title?: string;
  orderIndex?: number;
  summary?: string;
}

const VALID_LEVELS: OutlineLevel[] = ["BOOK", "VOLUME", "CHAPTER", "BEAT"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ success: false, error: "projectId 必填" }, { status: 400 });
  }
  try {
    const organizationId = await getOrganizationId();
    const items = await findOutlinesByProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ success: false, error: "请求需要 JSON 对象" }, { status: 400 });
  }
  const body = parsed as CreateBody;
  if (typeof body.projectId !== "string" || !body.projectId.trim() || typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200 ||
    (body.summary !== undefined && typeof body.summary !== "string") ||
    (body.parentId !== undefined && (typeof body.parentId !== "string" || !body.parentId.trim())) ||
    (body.orderIndex !== undefined && (!Number.isSafeInteger(body.orderIndex) || body.orderIndex < 0))) {
    return NextResponse.json(
      { success: false, error: "请提供有效项目、200字内非空标题和非负整数顺序；摘要与父级需为字符串" },
      { status: 400 }
    );
  }
  if (!body.level || !VALID_LEVELS.includes(body.level)) {
    return NextResponse.json(
      { success: false, error: `level 必须为 ${VALID_LEVELS.join(", ")} 之一` },
      { status: 400 }
    );
  }
  try {
    const organizationId = await getOrganizationId();
    const createdById = await getUserId();
    const outline = await createOutline({
      organizationId,
      projectId: body.projectId,
      level: body.level,
      title: body.title.trim(),
      orderIndex: body.orderIndex ?? 0,
      createdById,
      ...(body.parentId ? { parentId: body.parentId } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: outline }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /P2025|不存在/.test(message);
  if (!isNotFound) console.error("[api] outlines failed", error);
  return NextResponse.json({ success: false, error: isNotFound ? message : sanitizeServerMessage(message) }, { status: isNotFound ? 404 : 500 });
}
