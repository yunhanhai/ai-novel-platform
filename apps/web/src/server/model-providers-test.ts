import { parseEncryptionKey } from "@ai-novel/shared/crypto/encryption";
import type { PrismaClient } from "@ai-novel/db";
import { createAdapter, type ProviderRecord } from "@ai-novel/model-adapters";

const PING_TIMEOUT_MS = 15_000;
const PING_PROMPT = "请回复好";

export type PingMode = "fake" | "real";

export interface PingResult {
  ok: boolean;
  mode?: PingMode;
  error?: string;
  note?: string;
  latencyMs?: number;
}

export interface PingDeps {
  organizationId: string;
  providerId: string;
  prisma: PrismaClient;
  env?: NodeJS.ProcessEnv;
}

/**
 * 真实 1-token ping：解密 API key、用任意可用 Profile 的 modelName 创建适配器，
 * 发一条 max_tokens=1 的请求，验证整条链路可达。
 *
 * 失败语义：所有错误折叠为 { ok: false, error }，调用方决定 HTTP 状态。
 */
export async function pingProvider(deps: PingDeps): Promise<PingResult> {
  const env = deps.env ?? process.env;

  try {
    const provider = await deps.prisma.modelProvider.findFirst({
      where: { id: deps.providerId, organizationId: deps.organizationId }
    });
    if (!provider) {
      return { ok: false, error: "模型供应商不存在" };
    }
    if (provider.status !== "ACTIVE") {
      return { ok: false, error: `模型供应商状态为 ${provider.status}，无法测试` };
    }

    if (env.USE_FAKE_MODEL === "true") return { ok: true, mode: "fake" };
    const encryptionKey = parseEncryptionKey(env.ENCRYPTION_KEY);
    if (provider.authMode === "USER_KEY" && !encryptionKey) {
      return { ok: false, error: "ENCRYPTION_KEY 必须为完整 64 位十六进制密钥" };
    }
    const modelName = await pickModelNameForProvider(deps.prisma, provider.id, deps.organizationId);
    if (!modelName) {
      return {
        ok: false,
        error: "该模型供应商没有可用模型档案，请先创建一个模型档案再测试连通"
      };
    }

    const adapter = await createAdapter(
      provider as unknown as ProviderRecord,
      modelName,
      { encryptionKey, env }
    );

    const start = Date.now();
    const result = await withTimeout(
      adapter.generate(PING_PROMPT, { maxOutputTokens: 1 }),
      PING_TIMEOUT_MS
    );
    const latencyMs = Date.now() - start;

    return {
      ok: true,
      mode: "real",
      note: `已用模型 ${modelName} 完成 1-token ping`,
      latencyMs,
      ...(result.inputTokens || result.outputTokens
        ? { note: `已用模型 ${modelName}，输入 ${result.inputTokens} / 输出 ${result.outputTokens} tokens` }
        : {})
    };
  } catch (error: unknown) {
    return { ok: false, error: classifyError(error) };
  }
}

async function pickModelNameForProvider(
  prisma: PrismaClient,
  providerId: string,
  organizationId: string
): Promise<string | null> {
  const profile = await prisma.modelProfile.findFirst({
    where: { providerId, organizationId },
    orderBy: { createdAt: "asc" },
    select: { modelName: true }
  });
  return profile?.modelName?.trim() || null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PING_TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "PING_TIMEOUT") return `测试请求 ${PING_TIMEOUT_MS / 1000}s 超时`;
  if (/API_KEY_NOT_RESOLVED|API_KEY_DECRYPTION_FAILED/.test(message)) return "API 密钥未配置或解密失败";
  if (/UNSUPPORTED_PROVIDER/.test(message)) return "暂不支持此模型供应商类型";
  if (/401|403|unauthorized|invalid.*api.*key/i.test(message)) return "认证失败，请检查 API 密钥";
  if (/429|rate.?limit/i.test(message)) return "模型供应商限流，请稍后再试";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed/i.test(message)) return "网络不可达，请检查服务地址";
  if (/402|insufficient_quota|insufficient.*balance/i.test(message)) return "API 余额不足，请检查供应商额度";
  if (/404|model.*not.*found/i.test(message)) return "模型名不存在，请检查模型档案";
  return "测试失败，请检查供应商配置或稍后重试";
}
