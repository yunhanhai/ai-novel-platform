import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { createVolume, findVolumesByProject } from "../../../../../server/chapters";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";
import { sanitizeServerMessage } from "../../../../../server/api-errors";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const volumes = await findVolumesByProject(organizationId, projectId, prisma);
    return NextResponse.json({
      success: true,
      data: volumes.map((volume) => ({
        id: volume.id,
        title: volume.title,
        summary: volume.summary,
        orderIndex: volume.orderIndex,
        status: volume.status,
        createdAt: volume.createdAt.toISOString()
      }))
    });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] volumes list failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}

interface CreateVolumeBody {
  title?: string;
  summary?: string;
  orderIndex?: number;
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const body = (await request.json()) as CreateVolumeBody;
  const title = body.title?.trim();

  if (!title) {
    return NextResponse.json({ success: false, error: "分卷标题为必填项" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();

    async function nextOrderIndex(): Promise<number> {
      const last = await prisma.volume.findFirst({
        where: { organizationId, projectId },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true }
      });
      return (last?.orderIndex ?? 0) + 1;
    }

    async function insert(explicit: number | undefined) {
      const orderIndex = explicit ?? (await nextOrderIndex());
      return createVolume({
        organizationId,
        projectId,
        title: title!,
        orderIndex,
        summary: body.summary?.trim(),
        prisma
      });
    }

    let volume;
    try {
      volume = await insert(body.orderIndex);
    } catch (error: unknown) {
      // 并发新建会读到同一个最大值并撞唯一约束 (projectId, orderIndex)。
      // 仅当序号由服务端推导时重算一次；显式指定序号的重试没有意义。
      const isUnique =
        typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
      if (body.orderIndex !== undefined || !isUnique) throw error;
      volume = await insert(undefined);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id: volume.id,
          title: volume.title,
          summary: volume.summary,
          orderIndex: volume.orderIndex,
          status: volume.status,
          createdAt: volume.createdAt.toISOString()
        }
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] volume create failed", error);
    const isConflict = /unique|P2002/i.test(message);
    return NextResponse.json(
      { success: false, error: isConflict ? "该分卷序号已被占用" : sanitizeServerMessage(message) },
      { status: isConflict ? 409 : 500 }
    );
  }
}
