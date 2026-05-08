import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { createProject, findProjectsByOrganization } from "../../../server/projects";
import { getOrganizationId, getUserId } from "../../../server/context";

interface CreateBody {
  title?: string;
  slug?: string;
  type?: "LONG_NOVEL" | "SHORT_STORY";
  genre?: string;
  premise?: string;
  styleBrief?: string;
}

export async function GET() {
  try {
    const organizationId = getOrganizationId();
    const projects = await findProjectsByOrganization(organizationId, prisma);
    const data = await Promise.all(projects.map(toProjectListItem));
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  const { title, slug } = body;

  if (!title || !slug) {
    return NextResponse.json(
      { success: false, error: "title 和 slug 为必填项" },
      { status: 400 }
    );
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { success: false, error: "slug 仅支持小写字母、数字和连字符" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const createdById = getUserId();
    const project = await createProject({
      organizationId,
      createdById,
      title,
      slug,
      ...(body.type ? { type: body.type } : {}),
      ...(body.genre ? { genre: body.genre } : {}),
      ...(body.premise ? { premise: body.premise } : {}),
      ...(body.styleBrief ? { styleBrief: body.styleBrief } : {}),
      prisma
    });
    return NextResponse.json(
      { success: true, data: await toProjectListItem(project) },
      { status: 201 }
    );
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

async function toProjectListItem(project: {
  id: string;
  title: string;
  slug: string;
  type: string;
  genre: string | null;
  status: string;
  updatedAt: Date;
}) {
  const chapterCount = await prisma.chapter.count({
    where: { projectId: project.id, deletedAt: null }
  });
  return {
    id: project.id,
    title: project.title,
    slug: project.slug,
    type: project.type,
    genre: project.genre,
    status: project.status,
    updatedAt: project.updatedAt.toISOString(),
    chapterCount
  };
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const status = /已被占用|已存在/.test(message) ? 409 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}
