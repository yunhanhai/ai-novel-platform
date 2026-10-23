// 模型调用错误的分类与用户可读信息。
//
// 目的：job 失败时用户看到的不是 "HANDLER_RETRY / 已重试 N 次后放弃"，
// 而是「API key 无效」「baseURL 不可达」这类能自行排查的具体原因；
// 同时给 poll 层一个明确信号——配置类错误重试没有意义（401 永远 401），
// 网络与限流类才值得重试。

export type ModelErrorKind =
  | "CONFIG_INVALID_KEY" // key 无效 / 未授权（401/403）
  | "CONFIG_INSUFFICIENT_QUOTA" // 余额不足
  | "CONFIG_MODEL_NOT_FOUND" // 模型名不存在（404 或明确说明）
  | "CONFIG_BAD_BASE_URL" // baseURL 不可达 / DNS 失败
  | "TRANSIENT_RATE_LIMIT" // 限流（429）
  | "TRANSIENT_TIMEOUT" // 超时
  | "TRANSIENT_SERVER" // 服务端 5xx
  | "UNKNOWN";

export interface ClassifiedModelError {
  kind: ModelErrorKind;
  /** 用户可读的中文排查提示 */
  userMessage: string;
  /** 重试是否有意义 */
  retryable: boolean;
  /** 原始错误信息（进服务端日志） */
  raw?: string;
}

const KIND_TO_MESSAGE: Record<ModelErrorKind, string> = {
  CONFIG_INVALID_KEY: "API key 无效或未授权，请到「设置 → 模型设置」检查 key 并用「测试连接」验证",
  CONFIG_INSUFFICIENT_QUOTA: "API 余额不足，请到供应商控制台充值后重试",
  CONFIG_MODEL_NOT_FOUND: "模型名不存在，请到「设置 → 模型设置」确认模型名拼写正确",
  CONFIG_BAD_BASE_URL: "接口地址不可达，请检查供应商的 baseURL 是否正确",
  TRANSIENT_RATE_LIMIT: "请求过于频繁被限流，稍后会自动重试",
  TRANSIENT_TIMEOUT: "模型响应超时，稍后会自动重试",
  TRANSIENT_SERVER: "模型服务暂时不可用，稍后会自动重试",
  UNKNOWN: "模型调用失败，请查看服务端日志"
};

export function classifyModelError(error: unknown): ClassifiedModelError {
  const raw = error instanceof Error ? error.message : String(error);
  const status = extractStatus(error);
  const lower = raw.toLowerCase();

  // 状态码优先：明确且无歧义
  if (status === 401 || status === 403) {
    return build("CONFIG_INVALID_KEY", raw);
  }
  if (status === 402) {
    return build("CONFIG_INSUFFICIENT_QUOTA", raw);
  }
  if (status === 404) {
    return build("CONFIG_MODEL_NOT_FOUND", raw);
  }
  if (status === 429) {
    return build("TRANSIENT_RATE_LIMIT", raw);
  }
  if (status !== undefined && status >= 500) {
    return build("TRANSIENT_SERVER", raw);
  }

  // 文本特征：SDK 在连接层失败时往往没有状态码
  if (/invalid_api_key|incorrect api key|api key not valid|authentication/i.test(raw)) {
    return build("CONFIG_INVALID_KEY", raw);
  }
  if (/insufficient.*quota|billing|余额不足|欠费/i.test(raw)) {
    return build("CONFIG_INSUFFICIENT_QUOTA", raw);
  }
  if (/model.*not found|does not exist|no such model/i.test(raw)) {
    return build("CONFIG_MODEL_NOT_FOUND", raw);
  }
  if (/fetch failed|econnrefused|enotfound|eai_again|getaddrinfo|connect timeout|request failed/i.test(lower)) {
    return build("CONFIG_BAD_BASE_URL", raw);
  }
  if (/timed?\s?out|timeout|aborted|etimedout/i.test(lower)) {
    return build("TRANSIENT_TIMEOUT", raw);
  }
  if (/rate limit|too many requests/i.test(lower)) {
    return build("TRANSIENT_RATE_LIMIT", raw);
  }

  return build("UNKNOWN", raw);
}

export function isConfigError(kind: ModelErrorKind): boolean {
  return kind.startsWith("CONFIG_");
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { status?: unknown };
    if (typeof candidate.status === "number") return candidate.status;
  }
  return undefined;
}

function build(kind: ModelErrorKind, raw: string): ClassifiedModelError {
  return {
    kind,
    userMessage: KIND_TO_MESSAGE[kind],
    retryable: !isConfigError(kind),
    raw
  };
}
