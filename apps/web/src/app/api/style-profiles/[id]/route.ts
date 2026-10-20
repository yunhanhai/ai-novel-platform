import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  deactivateStyleProfile,
  updateStyleProfile
} from "../../../../server/style-profiles";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  styleBrief?: string;
  bannedWords?: string[];
  preferredWords?: string[];
  rhythmNotes?: string;
  referenceTexts?: string[];
  sentenceLengthProfile?: { avg: number; min: number; max: number; p50: number; p90: number };
  dialogueRatio?: number;
  descriptionDensity?: number;
  isActive?: boolean;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;

  try {
    const organizationId = await getOrganizationId();
    const updated = await updateStyleProfile(organizationId, id, buildPatchFields(body), prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const organizationId = await getOrganizationId();
    const result = await deactivateStyleProfile(organizationId, id, prisma);
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function buildPatchFields(body: PatchBody) {
  const data: Record<string, unknown> = {};
  if (body.styleBrief !== undefined) data.styleBrief = body.styleBrief;
  if (body.bannedWords !== undefined) data.bannedWords = body.bannedWords;
  if (body.preferredWords !== undefined) data.preferredWords = body.preferredWords;
  if (body.rhythmNotes !== undefined) data.rhythmNotes = body.rhythmNotes;
  if (body.referenceTexts !== undefined) data.referenceTexts = body.referenceTexts;
  if (body.isActive !== undefined) data.isActive = body.isActive;

  const stats: Record<string, unknown> = {};
  if (body.sentenceLengthProfile) stats.sentenceLengthProfile = body.sentenceLengthProfile;
  if (body.dialogueRatio !== undefined) stats.dialogueRatio = body.dialogueRatio;
  if (body.descriptionDensity !== undefined) stats.descriptionDensity = body.descriptionDensity;
  if (Object.keys(stats).length > 0) data.stats = stats;

  return data;
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /not found|不存在|P2025/i.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "风格画像不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
