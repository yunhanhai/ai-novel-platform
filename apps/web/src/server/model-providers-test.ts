import type { PrismaClient } from "@ai-novel/db";
import { createAdapter, type ProviderRecord } from "@ai-novel/model-adapters";

const PING_TIMEOUT_MS = 15_000;
const PING_PROMPT = "hi";

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

  if (env.USE_FAKE_MODEL === "true") {
    return { ok: true, mode: "fake" };
  }

  const encryptionKey = getEncryptionKey(env);
  if (!encryptionKey) {
    return { ok: false, error: "ENCRYPTION_KEY 未配置，无法发送测试请求" };
  }

  const provider = await deps.prisma.modelProvider.findFirst({
    where: { id: deps.providerId, organizationId: deps.organizationId }
  });
  if (!provider) {
    return { ok: false, error: "模型供应商不存在" };
  }
  if (provider.status !== "ACTIVE") {
    return { ok: false, error: `模型供应商状态为 ${provider.status}，无法测试` };
  }

  const modelName = await pickModelNameForProvider(deps.prisma, provider.id);
  if (!modelName) {
    return {
      ok: false,
      error: "该模型供应商没有可用模型档案，请先创建一个模型档案再测试连通"
    };
  }

  try {
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

function getEncryptionKey(env: NodeJS.ProcessEnv): Buffer | null {
  const hex = env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex.slice(0, 64), "hex");
}

async function pickModelNameForProvider(
  prisma: PrismaClient,
  providerId: string
): Promise<string | null> {
  const profile = await prisma.modelProfile.findFirst({
    where: { providerId },
    orderBy: { createdAt: "asc" },
    select: { modelName: true }
  });
  return profile?.modelName ?? null;
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
  if (/API_KEY_NOT_RESOLVED/.test(message)) return "API 密钥未配置或解密失败";
  if (/UNSUPPORTED_PROVIDER/.test(message)) return "暂不支持此模型供应商类型";
  if (/401|403|unauthorized|invalid.*api.*key/i.test(message)) return "认证失败，请检查 API 密钥";
  if (/429|rate.?limit/i.test(message)) return "模型供应商限流，请稍后再试";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed/i.test(message)) return "网络不可达，请检查服务地址";
  return `测试失败：${message}`;
}
