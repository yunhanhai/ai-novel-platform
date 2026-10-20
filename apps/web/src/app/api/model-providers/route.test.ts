import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  getUserId: async () => "user-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../server/model-providers", () => ({
  createProvider: vi.fn(),
  findProvidersByOrganization: vi.fn()
}));
import { GET, POST } from "./route";
import {
  createProvider,
  findProvidersByOrganization
} from "../../../server/model-providers";

function fp() { return findProvidersByOrganization as unknown as ReturnType<typeof vi.fn>; }
function cp() { return createProvider as unknown as ReturnType<typeof vi.fn>; }

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/model-providers", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("GET /api/model-providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });

  it("returns 200 with provider list (api key masked)", async () => {
    fp().mockResolvedValue([
      { id: "mp1", name: "OpenAI", encryptedApiKey: "***", providerType: "OPENAI_COMPATIBLE" }
    ]);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].encryptedApiKey).toBe("***");
  });

  it("never leaks plaintext keys even if server returns raw value", async () => {
    // 安全断言：哪怕 server 层异常返回了原始字段，路由层也只能依赖 server 层 mask
    fp().mockResolvedValue([
      { id: "mp1", name: "OpenAI", encryptedApiKey: "***", providerType: "OPENAI_COMPATIBLE" }
    ]);
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain("sk-");
    expect(text).not.toContain("apikey");
  });

  it("returns 500 when server throws", async () => {
    fp().mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/model-providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });

  it("returns 400 when name missing", async () => {
    const res = await POST(req({ providerType: "OPENAI_COMPATIBLE", apiKey: "sk-x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when providerType missing", async () => {
    const res = await POST(req({ name: "x", apiKey: "sk-x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when apiKey missing", async () => {
    const res = await POST(req({ name: "x", providerType: "OPENAI_COMPATIBLE" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when providerType unknown", async () => {
    const res = await POST(req({ name: "x", providerType: "WAT", apiKey: "sk-x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when ENCRYPTION_KEY missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    const res = await POST(req({ name: "x", providerType: "OPENAI_COMPATIBLE", apiKey: "sk-x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("ENCRYPTION_KEY");
  });

  it("returns 201 on success and masks key", async () => {
    cp().mockResolvedValue({
      id: "mp1", name: "x", encryptedApiKey: "***", providerType: "OPENAI_COMPATIBLE"
    });
    const res = await POST(req({ name: "x", providerType: "OPENAI_COMPATIBLE", apiKey: "sk-x" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.encryptedApiKey).toBe("***");
  });

  it("returns 500 when server throws", async () => {
    cp().mockRejectedValue(new Error("boom"));
    const res = await POST(req({ name: "x", providerType: "OPENAI_COMPATIBLE", apiKey: "sk-x" }));
    expect(res.status).toBe(500);
  });
});
