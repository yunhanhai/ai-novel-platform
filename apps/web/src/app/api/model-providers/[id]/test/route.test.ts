import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../../../server/model-providers", () => ({
  findProviderById: vi.fn()
}));

import { POST } from "./route";
import { findProviderById } from "../../../../../server/model-providers";

function fp() { return findProviderById as unknown as ReturnType<typeof vi.fn>; }
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

const originalEnv = { ...process.env };

describe("POST /api/model-providers/[id]/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns ok=false (200) when provider missing", async () => {
    fp().mockResolvedValue(null);
    const res = await POST(new Request("http://localhost/api/model-providers/x/test", { method: "POST" }), ctx("x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(false);
  });

  it("returns ok=true mode=fake under USE_FAKE_MODEL=true", async () => {
    process.env.USE_FAKE_MODEL = "true";
    fp().mockResolvedValue({ id: "mp1", encryptedApiKey: "***" });
    const res = await POST(new Request("http://localhost/api/model-providers/mp1/test", { method: "POST" }), ctx("mp1"));
    const body = await res.json();
    expect(body.data).toEqual({ ok: true, mode: "fake" });
  });

  it("returns ok=false when ENCRYPTION_KEY missing in real mode", async () => {
    process.env.USE_FAKE_MODEL = "false";
    delete process.env.ENCRYPTION_KEY;
    fp().mockResolvedValue({ id: "mp1", encryptedApiKey: "***" });
    const res = await POST(new Request("http://localhost/api/model-providers/mp1/test", { method: "POST" }), ctx("mp1"));
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toContain("ENCRYPTION_KEY");
  });

  it("returns ok=true with real-stub note when env ok", async () => {
    process.env.USE_FAKE_MODEL = "false";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    fp().mockResolvedValue({ id: "mp1", encryptedApiKey: "***" });
    const res = await POST(new Request("http://localhost/api/model-providers/mp1/test", { method: "POST" }), ctx("mp1"));
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.mode).toBe("real-stub");
  });

  it("returns ok=false on exception (still HTTP 200)", async () => {
    fp().mockRejectedValue(new Error("boom"));
    const res = await POST(new Request("http://localhost/api/model-providers/mp1/test", { method: "POST" }), ctx("mp1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(false);
  });
});
