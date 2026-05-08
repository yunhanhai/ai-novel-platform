import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import type { MethodType } from "@ai-novel/shared/methodology/templates";
import {
  createMethodology,
  createMethodologyFromTemplate,
  findMethodologiesByProject
} from "../../../server/writing-methodologies";
import { getOrganizationId } from "../../../server/context";

interface CustomCreateBody {
  projectId?: string;
  name?: string;
  methodType?: string;
  description?: string;
  outlineMetadata?: Record<string, unknown>;
  reviewCriteria?: Record<string, unknown>;
}

interface TemplateCreateBody {
  projectId?: string;
  methodType?: string;
  name?: string;
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
    const organizationId = getOrganizationId();
    const items = await findMethodologiesByProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromTemplate = searchParams.get("fromTemplate") === "true";
  const body = (await request.json()) as Record<string, unknown>;

  try {
    if (fromTemplate) return await handleFromTemplate(body as TemplateCreateBody);
    return await handleCustom(body as CustomCreateBody);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

async function handleFromTemplate(body: TemplateCreateBody): Promise<NextResponse> {
  const { projectId, methodType, name } = body;
  if (!projectId || !methodType) {
    return NextResponse.json(
      { success: false, error: "projectId 和 methodType 为必填项" },
      { status: 400 }
    );
  }
  if (methodType === "custom") {
    return NextResponse.json(
      { success: false, error: "custom 类型没有内置模板" },
      { status: 400 }
    );
  }

  const organizationId = getOrganizationId();
  const created = await createMethodologyFromTemplate({
    organizationId,
    projectId,
    methodType: methodType as MethodType,
    name,
    prisma
  });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

async function handleCustom(body: CustomCreateBody): Promise<NextResponse> {
  const { projectId, name, methodType } = body;
  if (!projectId || !name || !methodType) {
    return NextResponse.json(
      { success: false, error: "projectId、name、methodType 为必填项" },
      { status: 400 }
    );
  }

  const organizationId = getOrganizationId();
  const created = await createMethodology({
    organizationId,
    projectId,
    name,
    methodType,
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.outlineMetadata !== undefined ? { outlineMetadata: body.outlineMetadata } : {}),
    ...(body.reviewCriteria !== undefined ? { reviewCriteria: body.reviewCriteria } : {}),
    prisma
  });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const status = /已存在/.test(message) ? 409 : /未知方法论类型/.test(message) ? 400 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}
