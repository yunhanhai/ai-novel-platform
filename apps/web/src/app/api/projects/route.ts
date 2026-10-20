import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { createProject, findProjectsByOrganization, type WizardExtras, type WizardOutlineNode } from "../../../server/projects";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../server/context";

interface CreateBody {
  title?: string;
  slug?: string;
  type?: "LONG_NOVEL" | "SHORT_STORY";
  genre?: string;
  premise?: string;
  styleBrief?: string;
  wizard?: {
    methodType?: string;
    outlineNodes?: Array<{
      level?: string;
      title?: string;
      summary?: string;
      orderIndex?: number;
    }>;
  };
}

export async function GET() {
  try {
    const organizationId = await getOrganizationId();
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
    const organizationId = await getOrganizationId();
    const createdById = await getUserId();
    const wizard = sanitizeWizard(body.wizard);
    const project = await createProject({
      organizationId,
      createdById,
      title,
      slug,
      ...(body.type ? { type: body.type } : {}),
      ...(body.genre ? { genre: body.genre } : {}),
      ...(body.premise ? { premise: body.premise } : {}),
      ...(body.styleBrief ? { styleBrief: body.styleBrief } : {}),
      ...(wizard ? { wizard } : {}),
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

const VALID_METHODS = new Set([
  "none", "snowflake", "three_act", "four_act",
  "webnovel_speed", "romance_rhythm", "short_reversal", "custom"
]);
const VALID_LEVELS = new Set(["BOOK", "VOLUME", "CHAPTER", "BEAT"]);

function sanitizeWizard(input: CreateBody["wizard"]): WizardExtras | undefined {
  if (!input) return undefined;
  const wizard: WizardExtras = {};

  if (input.methodType && VALID_METHODS.has(input.methodType)) {
    wizard.methodType = input.methodType as WizardExtras["methodType"];
  }

  if (Array.isArray(input.outlineNodes) && input.outlineNodes.length > 0) {
    const nodes: WizardOutlineNode[] = [];
    for (const raw of input.outlineNodes) {
      const level = raw.level;
      const title = raw.title?.trim();
      const orderIndex = typeof raw.orderIndex === "number" ? raw.orderIndex : null;
      if (!level || !VALID_LEVELS.has(level) || !title || orderIndex === null) continue;
      nodes.push({
        level: level as WizardOutlineNode["level"],
        title,
        ...(raw.summary?.trim() ? { summary: raw.summary.trim() } : {}),
        orderIndex
      });
    }
    if (nodes.length > 0) wizard.outlineNodes = nodes;
  }

  return Object.keys(wizard).length > 0 ? wizard : undefined;
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
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  const status = /已被占用|已存在/.test(message) ? 409 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}
