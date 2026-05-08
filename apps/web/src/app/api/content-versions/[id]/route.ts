import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  getChapterVersion,
  restoreChapterVersion
} from "../../../../server/content-versions";
import { getOrganizationId, getUserId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const version = await getChapterVersion(organizationId, id, prisma);
    if (!version) {
      return NextResponse.json({ success: false, error: "版本不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: version });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

// POST /api/content-versions/[id]/restore 风格的便捷接口：
// 这里直接 POST {id} 视为 restore 操作，避免再加一层路由
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const updatedById = getUserId();
    const chapter = await restoreChapterVersion({
      organizationId,
      versionId: id,
      updatedById,
      prisma
    });
    return NextResponse.json({ success: true, data: chapter });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /不存在|P2025/.test(message);
  return NextResponse.json(
    { success: false, error: message },
    { status: isNotFound ? 404 : 500 }
  );
}
