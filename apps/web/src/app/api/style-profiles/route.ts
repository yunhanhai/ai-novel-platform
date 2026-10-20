import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  createStyleProfile,
  findStyleProfilesByProject
} from "../../../server/style-profiles";
import { getOrganizationId, isUnauthorizedError } from "../../../server/context";

interface CreateBody {
  projectId?: string;
  name?: string;
  styleBrief?: string;
  bannedWords?: string[];
  preferredWords?: string[];
  rhythmNotes?: string;
  referenceTexts?: string[];
  sentenceLengthProfile?: { avg: number; min: number; max: number; p50: number; p90: number };
  dialogueRatio?: number;
  descriptionDensity?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { success: false, error: "projectId 为必填查询参数" },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const items = await findStyleProfilesByProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  const { projectId, name } = body;

  if (!projectId || !name) {
    return NextResponse.json(
      { success: false, error: "projectId 和 name 为必填项" },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const profile = await createStyleProfile({
      organizationId,
      projectId,
      name,
      ...buildOptionalCreateFields(body),
      prisma
    });
    return NextResponse.json({ success: true, data: profile }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function buildOptionalCreateFields(body: CreateBody) {
  return {
    ...(body.styleBrief !== undefined ? { styleBrief: body.styleBrief } : {}),
    ...(body.bannedWords !== undefined ? { bannedWords: body.bannedWords } : {}),
    ...(body.preferredWords !== undefined ? { preferredWords: body.preferredWords } : {}),
    ...(body.rhythmNotes !== undefined ? { rhythmNotes: body.rhythmNotes } : {}),
    ...(body.referenceTexts !== undefined ? { referenceTexts: body.referenceTexts } : {}),
    ...buildStats(body)
  };
}

function buildStats(body: CreateBody) {
  const stats: Record<string, unknown> = {};
  if (body.sentenceLengthProfile) stats.sentenceLengthProfile = body.sentenceLengthProfile;
  if (body.dialogueRatio !== undefined) stats.dialogueRatio = body.dialogueRatio;
  if (body.descriptionDensity !== undefined) stats.descriptionDensity = body.descriptionDensity;
  return Object.keys(stats).length > 0 ? { stats } : {};
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  const status = /已存在/.test(message) ? 409 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}
