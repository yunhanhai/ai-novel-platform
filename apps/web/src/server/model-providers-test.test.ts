import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/model-adapters", () => ({
  createAdapter: vi.fn()
}));

import { pingProvider } from "./model-providers-test";
import { createAdapter } from "@ai-novel/model-adapters";

const originalEnv = { ...process.env };

function mockPrisma(opts: {
  provider?: { id: string; organizationId: string; status: string } | null;
  modelName?: string | null;
}) {
  return {
    modelProvider: {
      findFirst: vi.fn().mockResolvedValue(opts.provider ?? null)
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
      prisma: mockPrisma({})
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
      prisma: mockPrisma({})
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
    expect(res.error).toContain("Profile");
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
