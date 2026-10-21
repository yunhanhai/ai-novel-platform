// 登录失败速率限制（单实例内存实现）。
// 本地/单机部署足够；若将来多实例部署，需要换成 Redis 等共享存储。
// 双维度限流：按 IP 防止同一来源批量爆破，按邮箱防止分布式爆破单账号。

export interface RateLimitPolicy {
  windowMs: number;
  maxFailures: number;
  blockMs: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  retryAfterMs?: number;
}

interface Bucket {
  failures: number[];
  blockedUntil: number;
}

const buckets = new Map<string, Bucket>();

export const LOGIN_POLICY: RateLimitPolicy = {
  windowMs: 15 * 60 * 1000,
  maxFailures: 10,
  blockMs: 15 * 60 * 1000
};

function getBucket(key: string): Bucket {
  const existing = buckets.get(key);
  if (existing) return existing;
  const created: Bucket = { failures: [], blockedUntil: 0 };
  buckets.set(key, created);
  return created;
}

export function checkRateLimit(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitCheck {
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true };

  if (bucket.blockedUntil > now) {
    return { allowed: false, retryAfterMs: bucket.blockedUntil - now };
  }

  bucket.failures = bucket.failures.filter((at) => now - at < policy.windowMs);
  return { allowed: true };
}

export function recordFailure(key: string, policy: RateLimitPolicy, now = Date.now()): void {
  const bucket = getBucket(key);
  bucket.failures = bucket.failures.filter((at) => now - at < policy.windowMs);
  bucket.failures.push(now);

  if (bucket.failures.length >= policy.maxFailures) {
    bucket.blockedUntil = now + policy.blockMs;
    bucket.failures = [];
  }
}

export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

// 仅供测试使用：清空全部计数，避免用例之间互相污染。
export function resetRateLimitsForTests(): void {
  buckets.clear();
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
