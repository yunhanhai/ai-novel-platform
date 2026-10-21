import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { softDeleteProject, updateProject } from "../../../../server/projects";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";
import { sanitizeServerMessage } from "../../../../server/api-errors";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

interface UpdateProjectBody {
  title?: string;
  genre?: string | null;
  styleBrief?: string | null;
  premise?: string | null;
  status?: string;
}

const VALID_STATUSES = new Set(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: {
        id: true,
        title: true,
        genre: true,
        styleBrief: true,
        premise: true,
        status: true
      }
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "项目不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: project });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] project detail failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const body = (await request.json()) as UpdateProjectBody;

  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ success: false, error: "无效的项目状态" }, { status: 400 });
  }
  if (body.title !== undefined && body.title.trim().length === 0) {
    return NextResponse.json({ success: false, error: "项目标题不能为空" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();
    const project = await updateProject(
      organizationId,
      projectId,
      {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.genre !== undefined ? { genre: body.genre ?? undefined } : {}),
        ...(body.styleBrief !== undefined ? { styleBrief: body.styleBrief ?? undefined } : {}),
        ...(body.premise !== undefined ? { premise: body.premise ?? undefined } : {}),
        ...(body.status !== undefined
          ? { status: body.status as "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED" }
          : {})
      },
      prisma
    );

    return NextResponse.json({
      success: true,
      data: {
        id: project.id,
        title: project.title,
        genre: project.genre,
        styleBrief: project.styleBrief,
        premise: project.premise,
        status: project.status
      }
    });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    const isNotFound = /P2025|不存在|not found/i.test(message);
    if (!isNotFound) console.error("[api] project update failed", error);
    return NextResponse.json(
      { success: false, error: isNotFound ? "项目不存在" : sanitizeServerMessage(message) },
      { status: isNotFound ? 404 : 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const existing = await prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "项目不存在" }, { status: 404 });
    }

    await softDeleteProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: { id: projectId } });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] project delete failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
