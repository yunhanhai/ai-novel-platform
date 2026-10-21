import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { deleteVolume, updateVolume } from "../../../../server/chapters";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";
import { sanitizeServerMessage } from "../../../../server/api-errors";

interface RouteContext {
  params: Promise<{ volumeId: string }>;
}

interface UpdateVolumeBody {
  title?: string;
  summary?: string;
  status?: string;
}

const VALID_STATUSES = new Set(["PLANNED", "DRAFTING", "FINISHED"]);

export async function PATCH(request: Request, context: RouteContext) {
  const { volumeId } = await context.params;
  const body = (await request.json()) as UpdateVolumeBody;

  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ success: false, error: "无效的分卷状态" }, { status: 400 });
  }
  if (body.title !== undefined && body.title.trim().length === 0) {
    return NextResponse.json({ success: false, error: "分卷标题不能为空" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();
    const volume = await updateVolume(
      organizationId,
      volumeId,
      {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.status !== undefined ? { status: body.status as "PLANNED" | "DRAFTING" | "FINISHED" } : {})
      },
      prisma
    );

    return NextResponse.json({
      success: true,
      data: {
        id: volume.id,
        title: volume.title,
        summary: volume.summary,
        orderIndex: volume.orderIndex,
        status: volume.status
      }
    });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    const isNotFound = /P2025|不存在|not found/i.test(message);
    if (!isNotFound) console.error("[api] volume update failed", error);
    return NextResponse.json(
      { success: false, error: isNotFound ? "分卷不存在" : sanitizeServerMessage(message) },
      { status: isNotFound ? 404 : 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { volumeId } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    await deleteVolume(organizationId, volumeId, prisma);
    return NextResponse.json({ success: true, data: { id: volumeId } });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    const isNotFound = /P2025|不存在|not found/i.test(message);
    if (!isNotFound) console.error("[api] volume delete failed", error);
    return NextResponse.json(
      { success: false, error: isNotFound ? "分卷不存在" : sanitizeServerMessage(message) },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
