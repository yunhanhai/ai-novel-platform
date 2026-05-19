import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { findProviderById } from "../../../../../server/model-providers";
import { getOrganizationId } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 测试 Provider 连通性。
 * - USE_FAKE_MODEL=true 时直接返回 fake OK，不调真实 API
 * - 真实模式下当前阶段也只能做"存在性校验"。真实 ping 需 packages/model-adapters
 *   抽出后接入（决策点 A，Phase B 完成后再补 TODO 中描述的逻辑）。
 * - 任何异常都返回 HTTP 200 + body.ok=false，前端按业务错误展示。
 */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const organizationId = getOrganizationId();
    const provider = await findProviderById(organizationId, id, prisma);
    if (!provider) {
      return NextResponse.json({ success: true, data: { ok: false, error: "Provider 不存在" } });
    }

    if (process.env.USE_FAKE_MODEL === "true") {
      return NextResponse.json({ success: true, data: { ok: true, mode: "fake" } });
    }

    // TODO(phase-B-adapters): 当 packages/model-adapters 落地后，在此发 1-token ping
    // 当前阶段仅校验加密 key 存在性 + ENCRYPTION_KEY 配置
    if (!process.env.ENCRYPTION_KEY) {
      return NextResponse.json({
        success: true,
        data: { ok: false, error: "ENCRYPTION_KEY 未配置，无法发送测试请求" }
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ok: true,
        mode: "real-stub",
        note: "真实连通测试将在 model-adapters 抽出后启用"
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: true, data: { ok: false, error: message } });
  }
}
