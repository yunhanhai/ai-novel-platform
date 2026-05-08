import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  createPlotThread,
  findPlotThreadsByProject
} from "../../../server/writing-assets";
import { getOrganizationId, getUserId } from "../../../server/context";

const THREAD_TYPES = ["main", "side", "foreshadowing", "mystery", "conflict"] as const;
type ThreadType = (typeof THREAD_TYPES)[number];

interface CreateBody {
  projectId?: string;
  threadType?: ThreadType;
  title?: string;
  description?: string;
  plantedChapterId?: string;
  expectedPayoffChapterId?: string;
  priority?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ success: false, error: "projectId 必填" }, { status: 400 });
  }
  try {
    const organizationId = getOrganizationId();
    const items = await findPlotThreadsByProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  if (!body.projectId || !body.title || !body.threadType) {
    return NextResponse.json(
      { success: false, error: "projectId、title、threadType 为必填项" },
      { status: 400 }
    );
  }
  if (!THREAD_TYPES.includes(body.threadType)) {
    return NextResponse.json(
      { success: false, error: `threadType 必须为 ${THREAD_TYPES.join(", ")} 之一` },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const createdById = getUserId();
    const thread = await createPlotThread({
      organizationId,
      projectId: body.projectId,
      threadType: body.threadType,
      title: body.title,
      createdById,
      ...(body.description ? { description: body.description } : {}),
      ...(body.plantedChapterId ? { plantedChapterId: body.plantedChapterId } : {}),
      ...(body.expectedPayoffChapterId ? { expectedPayoffChapterId: body.expectedPayoffChapterId } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: thread }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
