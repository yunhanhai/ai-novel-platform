import { NextResponse } from "next/server";

/**
 * 暴露当前 web 进程的运行时模型模式给前端 UI。
 * - useFakeModel：USE_FAKE_MODEL=true 时整套生成走 fake，前端显示"演示模式"横幅
 * - encryptionKeyConfigured：检查 ENCRYPTION_KEY 是否配置（64 hex），未配置时禁止存 API key
 */
export async function GET() {
  const useFakeModel = process.env.USE_FAKE_MODEL === "true";
  const rawKey = process.env.ENCRYPTION_KEY ?? "";
  const encryptionKeyConfigured = /^[0-9a-fA-F]{64}$/.test(rawKey);

  return NextResponse.json({
    success: true,
    data: { useFakeModel, encryptionKeyConfigured }
  });
}
