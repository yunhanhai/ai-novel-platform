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