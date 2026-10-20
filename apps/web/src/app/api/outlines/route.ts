import { NextResponse } from "next/server";
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
  const body = (await request.json()) as CreateBody;
  if (!body.projectId || !body.level || !body.title) {
    return NextResponse.json(
      { success: false, error: "projectId、level、title 为必填项" },
      { status: 400 }
    );
  }
  if (!VALID_LEVELS.includes(body.level)) {
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
      title: body.title,
      orderIndex: body.orderIndex ?? 0,
      createdById,
      ...(body.parentId ? { parentId: body.parentId } : {}),
      ...(body.summary ? { summary: body.summary } : {}),
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
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
