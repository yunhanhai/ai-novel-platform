import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  deactivateMethodology,
  updateMethodology
} from "../../../../server/writing-methodologies";
import { getOrganizationId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  description?: string;
  outlineMetadata?: Record<string, unknown>;
  reviewCriteria?: Record<string, unknown>;
  isActive?: boolean;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;

  try {
    const organizationId = getOrganizationId();
    const updated = await updateMethodology(organizationId, id, buildPatchFields(body), prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const organizationId = getOrganizationId();
    const result = await deactivateMethodology(organizationId, id, prisma);
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function buildPatchFields(body: PatchBody) {
  const data: Record<string, unknown> = {};
  if (body.description !== undefined) data.description = body.description;
  if (body.outlineMetadata !== undefined) data.outlineMetadata = body.outlineMetadata;
  if (body.reviewCriteria !== undefined) data.reviewCriteria = body.reviewCriteria;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  return data;
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /not found|不存在|P2025/i.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "方法论不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
