import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../../../server/model-providers-test", () => ({
  pingProvider: vi.fn()
}));

import { POST } from "./route";
import { pingProvider } from "../../../../../server/model-providers-test";

function pp() { return pingProvider as unknown as ReturnType<typeof vi.fn>; }
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

  it("returns ok=true mode=fake under USE_FAKE_MODEL", async () => {
    pp().mockResolvedValue({ ok: true, mode: "fake" });
    const res = await POST(
      new Request("http://localhost/api/model-providers/mp1/test", { method: "POST" }),
      ctx("mp1")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ok: true, mode: "fake" });
  });

  it("forwards ok=false from helper as HTTP 200", async () => {
    pp().mockResolvedValue({ ok: false, error: "Provider 不存在" });
    const res = await POST(
      new Request("http://localhost/api/model-providers/x/test", { method: "POST" }),
      ctx("x")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toContain("不存在");
  });

  it("forwards mode=real success", async () => {
    pp().mockResolvedValue({ ok: true, mode: "real", note: "已用模型 gpt-4o-mini" });
    const res = await POST(
      new Request("http://localhost/api/model-providers/mp1/test", { method: "POST" }),
      ctx("mp1")
    );
    const body = await res.json();
    expect(body.data).toEqual({ ok: true, mode: "real", note: "已用模型 gpt-4o-mini" });
  });

  it("returns ok=false on exception (still HTTP 200)", async () => {
    pp().mockRejectedValue(new Error("boom"));
    const res = await POST(
      new Request("http://localhost/api/model-providers/mp1/test", { method: "POST" }),
      ctx("mp1")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toBe("boom");
  });

  it("passes providerId from route params", async () => {
    pp().mockResolvedValue({ ok: true, mode: "fake" });
    await POST(
      new Request("http://localhost/api/model-providers/abc-123/test", { method: "POST" }),
      ctx("abc-123")
    );
    expect(pp()).toHaveBeenCalledWith(expect.objectContaining({ providerId: "abc-123" }));
  });
});
