import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({getOrganizationId: async () => "org-1", isUnauthorizedError: () => false }));
vi.mock("../../../../server/model-providers", () => ({
  findProviderById: vi.fn(),
  updateProvider: vi.fn(),
  softDeleteProvider: vi.fn()
}));

import { GET, PATCH, DELETE } from "./route";
import {
  findProviderById,
  updateProvider,
  softDeleteProvider
} from "../../../../server/model-providers";

function fp() { return findProviderById as unknown as ReturnType<typeof vi.fn>; }
function up() { return updateProvider as unknown as ReturnType<typeof vi.fn>; }
function dp() { return softDeleteProvider as unknown as ReturnType<typeof vi.fn>; }

function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("model-providers [id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("GET 200 with masked key", async () => {
    fp().mockResolvedValue({ id: "mp1", name: "OpenAI", encryptedApiKey: "***" });
    const res = await GET(new Request("http://localhost/api/model-providers/mp1"), ctx("mp1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.encryptedApiKey).toBe("***");
  });

  it("GET 404 when missing", async () => {
    fp().mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/model-providers/x"), ctx("x"));
    expect(res.status).toBe(404);
  });

  it("PATCH 200 updates non-secret fields", async () => {
    up().mockResolvedValue({ id: "mp1", name: "Renamed", encryptedApiKey: "***" });
    const res = await PATCH(
      new Request("http://localhost/api/model-providers/mp1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" })
      }),
      ctx("mp1")
    );
    expect(res.status).toBe(200);
  });

  it("PATCH 400 when apiKey present in body", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/model-providers/mp1", {
        method: "PATCH",
        body: JSON.stringify({ apiKey: "sk-new" })
      }),
      ctx("mp1")
    );
    expect(res.status).toBe(400);
    expect(up()).not.toHaveBeenCalled();
  });

  it("PATCH 404 when target missing", async () => {
    up().mockRejectedValue(new Error("P2025"));
    const res = await PATCH(
      new Request("http://localhost/api/model-providers/mp1", {
        method: "PATCH",
        body: JSON.stringify({ name: "x" })
      }),
      ctx("mp1")
    );
    expect(res.status).toBe(404);
  });

  it("DELETE 200 marks as DISABLED", async () => {
    dp().mockResolvedValue({ id: "mp1", status: "DISABLED", encryptedApiKey: "***" });
    const res = await DELETE(new Request("http://localhost/api/model-providers/mp1"), ctx("mp1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("DISABLED");
  });

  it("DELETE 404 when target missing", async () => {
    dp().mockRejectedValue(new Error("P2025"));
    const res = await DELETE(new Request("http://localhost/api/model-providers/x"), ctx("x"));
    expect(res.status).toBe(404);
  });
});
