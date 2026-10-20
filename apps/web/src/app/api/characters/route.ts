import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  createCharacter,
  findCharactersByProject
} from "../../../server/writing-assets";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../server/context";

interface CreateBody {
  projectId?: string;
  name?: string;
  roleType?: "protagonist" | "antagonist" | "supporting" | "minor";
  aliases?: string[];
  personality?: string;
  motivation?: string;
  speechPattern?: string;
  appearance?: string;
  knowledgeBoundary?: { knows: string[]; unknown: string[] };
  arc?: string;
  constraints?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ success: false, error: "projectId 必填" }, { status: 400 });
  }
  try {
    const organizationId = await getOrganizationId();
    const items = await findCharactersByProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  if (!body.projectId || !body.name || !body.roleType) {
    return NextResponse.json(
      { success: false, error: "projectId、name、roleType 为必填项" },
      { status: 400 }
    );
  }
  try {
    const organizationId = await getOrganizationId();
    const createdById = await getUserId();
    const character = await createCharacter({
      organizationId,
      projectId: body.projectId,
      name: body.name,
      roleType: body.roleType,
      createdById,
      ...(body.aliases ? { aliases: body.aliases } : {}),
      ...(body.personality ? { personality: body.personality } : {}),
      ...(body.motivation ? { motivation: body.motivation } : {}),
      ...(body.speechPattern ? { speechPattern: body.speechPattern } : {}),
      ...(body.appearance ? { appearance: body.appearance } : {}),
      ...(body.knowledgeBoundary ? { knowledgeBoundary: body.knowledgeBoundary } : {}),
      ...(body.arc ? { arc: body.arc } : {}),
      ...(body.constraints ? { constraints: body.constraints } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: character }, { status: 201 });
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
