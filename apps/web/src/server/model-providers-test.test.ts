import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/model-adapters", () => ({
  createAdapter: vi.fn()
}));

import { pingProvider } from "./model-providers-test";
import { createAdapter } from "@ai-novel/model-adapters";

const originalEnv = { ...process.env };

function mockPrisma(opts: {
  provider?: { id: string; organizationId: string; status: string; authMode?: string } | null;
  modelName?: string | null;
}) {
  return {
    modelProvider: {
      findFirst: vi.fn().mockResolvedValue(opts.provider ? { authMode: "USER_KEY", ...opts.provider } : null)
    },
    modelProfile: {
      findFirst: vi.fn().mockResolvedValue(opts.modelName ? { modelName: opts.modelName } : null)
    }
  } as unknown as Parameters<typeof pingProvider>[0]["prisma"];
}

describe("pingProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns ok=true mode=fake when USE_FAKE_MODEL=true", async () => {
    process.env.USE_FAKE_MODEL = "true";
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "p1",
      prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE" } })
    });
    expect(res).toEqual({ ok: true, mode: "fake" });
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("returns ok=false when ENCRYPTION_KEY missing in real mode", async () => {
    process.env.USE_FAKE_MODEL = "false";
    delete process.env.ENCRYPTION_KEY;
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "p1",
      prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE" } })
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ENCRYPTION_KEY");
  });

  it("returns ok=false when provider not found", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "missing",
      prisma: mockPrisma({ provider: null })
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("不存在");
  });

  it("returns ok=false when provider DISABLED", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "p1",
      prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "DISABLED" } })
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("DISABLED");
  });

  it("returns ok=false when no profile to source modelName", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "p1",
      prisma: mockPrisma({
        provider: { id: "p1", organizationId: "org-1", status: "ACTIVE" },
        modelName: null
      })
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("模型档案");
  });

  it("returns ok=true mode=real on adapter success", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    (createAdapter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      generate: vi.fn().mockResolvedValue({ text: "ok", inputTokens: 1, outputTokens: 1 }),
      modelName: "gpt-4o-mini",
      providerType: "OPENAI_COMPATIBLE"
    });
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "p1",
      prisma: mockPrisma({
        provider: { id: "p1", organizationId: "org-1", status: "ACTIVE" },
        modelName: "gpt-4o-mini"
      })
    });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("real");
    expect(res.note).toContain("gpt-4o-mini");
  });

  it("classifies 401 as auth failure", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    (createAdapter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      generate: vi.fn().mockRejectedValue(new Error("401 unauthorized")),
      modelName: "gpt-4o-mini",
      providerType: "OPENAI_COMPATIBLE"
    });
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "p1",
      prisma: mockPrisma({
        provider: { id: "p1", organizationId: "org-1", status: "ACTIVE" },
        modelName: "gpt-4o-mini"
      })
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("认证");
  });

  it("classifies network error", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    (createAdapter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      generate: vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED")),
      modelName: "x",
      providerType: "OPENAI_COMPATIBLE"
    });
    const res = await pingProvider({
      organizationId: "org-1",
      providerId: "p1",
      prisma: mockPrisma({
        provider: { id: "p1", organizationId: "org-1", status: "ACTIVE" },
        modelName: "x"
      })
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("网络");
  });
});

describe("connection boundary", () => {
  beforeEach(() => { vi.mocked(createAdapter).mockReset(); });
  it("allows PLATFORM_KEY ping without an unused encryption key", async () => {
    const prisma = mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "PLATFORM_KEY" }, modelName: "model" });
    vi.mocked(createAdapter).mockResolvedValue({ generate: vi.fn().mockResolvedValue({ text: "好", inputTokens: 1, outputTokens: 1 }) } as never);
    expect(await pingProvider({ organizationId: "org-1", providerId: "p1", prisma, env: { NODE_ENV: "test", USE_FAKE_MODEL: "false", OPENAI_API_KEY: "placeholder" } })).toMatchObject({ ok: true, mode: "real" });
  });
  it("checks provider ownership even in demonstration mode", async () => {
    expect(await pingProvider({ organizationId: "org-1", providerId: "foreign", prisma: mockPrisma({}), env: { NODE_ENV: "test", USE_FAKE_MODEL: "true" } })).toMatchObject({ ok: false });
  });
  it.each(["a".repeat(64) + "suffix", "z".repeat(64)])("rejects malformed USER_KEY master key %s", async key => {
    const result = await pingProvider({ organizationId: "org-1", providerId: "p1", prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "USER_KEY" }, modelName: "model" }), env: { NODE_ENV: "test", USE_FAKE_MODEL: "false", ENCRYPTION_KEY: key } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("64");
    expect(createAdapter).not.toHaveBeenCalled();
  });
  it("scopes the profile lookup to the same organization and provider", async () => {
    const prisma = mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "PLATFORM_KEY" } });
    await pingProvider({ organizationId: "org-1", providerId: "p1", prisma, env: { NODE_ENV: "test", USE_FAKE_MODEL: "false" } });
    expect(prisma.modelProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { providerId: "p1", organizationId: "org-1" } }));
  });
  it("never returns unknown adapter error credentials", async () => {
    vi.mocked(createAdapter).mockRejectedValue(new Error("unexpected secret-credential-in-response"));
    const result = await pingProvider({ organizationId: "org-1", providerId: "p1", prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "USER_KEY" }, modelName: "model" }), env: { NODE_ENV: "test", USE_FAKE_MODEL: "false", ENCRYPTION_KEY: "a".repeat(64) } });
    expect(result.error).not.toContain("secret-credential");
  });
});
it("folds a profile lookup failure into a safe connection result", async () => {
  const prisma = mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "PLATFORM_KEY" }, modelName: "x" });
  vi.mocked(prisma.modelProfile.findFirst).mockRejectedValueOnce(new Error("private-database-host"));
  const result = await pingProvider({ organizationId: "org-1", providerId: "p1", prisma, env: { NODE_ENV: "test", USE_FAKE_MODEL: "false" } });
  expect(result.ok).toBe(false);
  expect(result.error).not.toContain("private-database");
});
describe("bounded connection requests", () => {
  afterEach(() => { vi.useRealTimers(); vi.mocked(createAdapter).mockReset(); });
  const deps = () => ({ organizationId: "org-1", providerId: "p1", prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "PLATFORM_KEY" }, modelName: "model" }), env: { NODE_ENV: "test" as const, USE_FAKE_MODEL: "false", OPENAI_API_KEY: "local-placeholder" } });
  it("sets no SDK retries and a 15s transport deadline on each ping", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "好", inputTokens: 1, outputTokens: 1 });
    vi.mocked(createAdapter).mockResolvedValue({ generate } as never);
    expect((await pingProvider(deps())).ok).toBe(true);
    expect(generate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxOutputTokens: 1, timeoutMs: 15000, maxRetries: 0, signal: expect.any(AbortSignal) }));
    expect(generate.mock.calls[0]?.[1].signal.aborted).toBe(false);
  });
  it("aborts the underlying request when the displayed timeout expires", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const generate = vi.fn((_prompt: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    vi.mocked(createAdapter).mockResolvedValue({ generate } as never);
    const result = pingProvider(deps());
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toMatchObject({ ok: false, error: "测试请求 15s 超时" });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears the deadline after a successful ping", async () => {
    vi.useFakeTimers();
    const generate = vi.fn().mockResolvedValue({ text: "好", inputTokens: 1, outputTokens: 1 });
    vi.mocked(createAdapter).mockResolvedValue({ generate } as never);
    expect((await pingProvider(deps())).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(15001);
    expect(generate.mock.calls[0]?.[1].signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
it("reports the same timeout hint if the SDK transport deadline wins the race", async () => {
  const error = new Error("Request timed out.");
  const generate = vi.fn().mockRejectedValue(error);
  vi.mocked(createAdapter).mockResolvedValue({ generate } as never);
  const result = await pingProvider({ organizationId: "org-1", providerId: "p1", prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "PLATFORM_KEY" }, modelName: "model" }), env: { NODE_ENV: "test", USE_FAKE_MODEL: "false", OPENAI_API_KEY: "local-placeholder" } });
  expect(result).toMatchObject({ ok: false, error: "测试请求 15s 超时" });
});
it("cancels the actual SDK socket on the 15s ping deadline", async () => {
  const { createServer } = await import("node:http");
  const { createOpenAIAdapter } = await import("@ai-novel/model-adapters/openai-adapter");
  let requestCount = 0;
  let observeClosed!: () => void;
  const closed = new Promise<void>(resolve => { observeClosed = resolve; });
  const server = createServer((request, response) => {
    requestCount++;
    request.resume();
    response.on("close", observeClosed);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("local listener unavailable");
    const sdkAdapter = createOpenAIAdapter({ apiKey: "loopback-placeholder", baseUrl: `http://127.0.0.1:${address.port}/v1`, modelName: "local-model", providerType: "OPENAI_COMPATIBLE" });
    vi.mocked(createAdapter).mockResolvedValue(sdkAdapter);
    const result = await pingProvider({ organizationId: "org-1", providerId: "p1", prisma: mockPrisma({ provider: { id: "p1", organizationId: "org-1", status: "ACTIVE", authMode: "PLATFORM_KEY" }, modelName: "local-model" }), env: { NODE_ENV: "test", USE_FAKE_MODEL: "false", OPENAI_API_KEY: "loopback-placeholder" } });
    expect(result).toMatchObject({ ok: false, error: "测试请求 15s 超时" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("socket remained open")), 3000); })]); }
    finally { if (timer) clearTimeout(timer); }
    expect(requestCount).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.mocked(createAdapter).mockReset();
  }
}, 22000);