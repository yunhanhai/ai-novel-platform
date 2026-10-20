import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../../server/deslop-rules", () => ({
  updateDeslopRule: vi.fn(),
  deactivateDeslopRule: vi.fn()
}));

import { PATCH, DELETE } from "./route";
import { updateDeslopRule, deactivateDeslopRule } from "../../../../server/deslop-rules";

function ud() { return updateDeslopRule as unknown as ReturnType<typeof vi.fn>; }
function dd() { return deactivateDeslopRule as unknown as ReturnType<typeof vi.fn>; }
function routeCtx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("PATCH /api/deslop-rules/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("updates rule (200)", async () => {
    ud().mockResolvedValue({ id: "r-1", isActive: false });
    const res = await PATCH(new Request("http://localhost/api/deslop-rules/r-1", {
      method: "PATCH", body: JSON.stringify({ isActive: false })
    }), routeCtx("r-1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 on P2025", async () => {
    ud().mockRejectedValue(new Error("P2025"));
    const res = await PATCH(new Request("http://localhost/api/deslop-rules/r-1", {
      method: "PATCH", body: JSON.stringify({})
    }), routeCtx("r-1"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/deslop-rules/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("deactivates rule (200)", async () => {
    dd().mockResolvedValue({ id: "r-1", isActive: false });
    const res = await DELETE(new Request("http://localhost/api/deslop-rules/r-1"), routeCtx("r-1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when not found", async () => {
    dd().mockRejectedValue(new Error("不存在"));
    const res = await DELETE(new Request("http://localhost/api/deslop-rules/r-1"), routeCtx("r-1"));
    expect(res.status).toBe(404);
  });
});
