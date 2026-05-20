import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { pingProvider } from "../../../../../server/model-providers-test";
import { getOrganizationId } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 测试 Provider 连通性。
 * - USE_FAKE_MODEL=true → 直接返回 fake OK，不调真实 API
 * - 真实模式 → 用任意 Profile 的 modelName 发 1-token ping
 * - 任何异常都返回 HTTP 200 + body.ok=false，前端按业务错误展示
 */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const result = await pingProvider({ organizationId, providerId: id, prisma });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: true, data: { ok: false, error: message } });
  }
}
