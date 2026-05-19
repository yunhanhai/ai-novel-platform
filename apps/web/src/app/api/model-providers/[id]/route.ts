import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  findProviderById,
  updateProvider,
  softDeleteProvider
} from "../../../../server/model-providers";
import { getOrganizationId } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  name?: string;
  baseUrl?: string;
  isDefault?: boolean;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const provider = await findProviderById(organizationId, id, prisma);
    if (!provider) {
      return NextResponse.json({ success: false, error: "Provider 不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: provider });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody & { apiKey?: string };

  // apiKey 不允许通过 PATCH 改，必须走 rotate 端点（本期未单独开 endpoint，
  // 通过 POST + 删除老 provider 完成；这里只拦截以防止误操作）
  if (typeof body.apiKey !== "undefined") {
    return NextResponse.json(
      { success: false, error: "apiKey 不允许通过 PATCH 修改，请删除后重建或调用 rotate" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const updated = await updateProvider(organizationId, id, body, prisma);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const provider = await softDeleteProvider(organizationId, id, prisma);
    return NextResponse.json({ success: true, data: provider });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  const isNotFound = /P2025|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "Provider 不存在" : message },
    { status: isNotFound ? 404 : 500 }
  );
}
