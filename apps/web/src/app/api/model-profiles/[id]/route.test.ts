import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../../server/model-profiles", () => ({
  updateProfile: vi.fn(),
  softDeleteProfile: vi.fn()
}));

import { PATCH, DELETE } from "./route";
import {
  updateProfile,
  softDeleteProfile
} from "../../../../server/model-profiles";

function up() { return updateProfile as unknown as ReturnType<typeof vi.fn>; }
function dp() { return softDeleteProfile as unknown as ReturnType<typeof vi.fn>; }

function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("model-profiles [id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PATCH 200 with valid field", async () => {
    up().mockResolvedValue({ id: "mpf1", temperature: 0.7 });
    const res = await PATCH(
      new Request("http://localhost/api/model-profiles/mpf1", {
        method: "PATCH",
        body: JSON.stringify({ temperature: 0.7 })
      }),
      ctx("mpf1")
    );
    expect(res.status).toBe(200);
  });

  it("PATCH 400 when taskType invalid", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/model-profiles/mpf1", {
        method: "PATCH",
        body: JSON.stringify({ taskType: "unknown" })
      }),
      ctx("mpf1")
    );
    expect(res.status).toBe(400);
  });

  it("PATCH 404 when target missing", async () => {
    up().mockRejectedValue(new Error("P2025"));
    const res = await PATCH(
      new Request("http://localhost/api/model-profiles/mpf1", {
        method: "PATCH",
        body: JSON.stringify({ name: "x" })
      }),
      ctx("mpf1")
    );
    expect(res.status).toBe(404);
  });

  it("DELETE 200", async () => {
    dp().mockResolvedValue({ id: "mpf1" });
    const res = await DELETE(new Request("http://localhost/api/model-profiles/mpf1"), ctx("mpf1"));
    expect(res.status).toBe(200);
  });

  it("DELETE 404", async () => {
    dp().mockRejectedValue(new Error("P2025"));
    const res = await DELETE(new Request("http://localhost/api/model-profiles/mpf1"), ctx("mpf1"));
    expect(res.status).toBe(404);
  });
});
