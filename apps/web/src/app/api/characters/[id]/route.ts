import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { deleteCharacter, updateCharacter } from "../../../../server/writing-assets";
import { getOrganizationId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  name?: string;
  aliases?: string[];
  roleType?: string;
  personality?: string;
  motivation?: string;
  speechPattern?: string;
  appearance?: string;
  knowledgeBoundary?: { knows: string[]; unknown: string[] };
  arc?: string;
  constraints?: string;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;
  try {
    const organizationId = getOrganizationId();
    const updated = await updateCharacter(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const result = await deleteCharacter(organizationId, id, prisma);
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /P2025|not found|不存在/i.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "角色不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
