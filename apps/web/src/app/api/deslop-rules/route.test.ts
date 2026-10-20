import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));

vi.mock("../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../server/deslop-rules", () => ({
  createDeslopRule: vi.fn(),
  findDeslopRulesByProject: vi.fn()
}));

import { GET, POST } from "./route";
import { createDeslopRule, findDeslopRulesByProject } from "../../../server/deslop-rules";

function fp() { return findDeslopRulesByProject as unknown as ReturnType<typeof vi.fn>; }
function cp() { return createDeslopRule as unknown as ReturnType<typeof vi.fn>; }

describe("GET /api/deslop-rules", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when projectId missing", async () => {
    const res = await GET(new Request("http://localhost/api/deslop-rules"));
    expect(res.status).toBe(400);
  });

  it("returns rules list (200)", async () => {
    fp().mockResolvedValue([{ id: "r-1", pattern: "忽然", ruleType: "exact_match", category: "ai_slop" }]);
    const res = await GET(new Request("http://localhost/api/deslop-rules?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/deslop-rules", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/deslop-rules", { method: "POST", body: JSON.stringify(body) });
  }

  it("returns 400 when required fields missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when ruleType invalid", async () => {
    const res = await POST(req({ projectId: "p", ruleType: "bad", pattern: "x", category: "test" }));
    expect(res.status).toBe(400);
  });

  it("creates rule and returns 201", async () => {
    cp().mockResolvedValue({ id: "r-new", pattern: "忽然" });
    const res = await POST(req({ projectId: "proj-1", ruleType: "exact_match", pattern: "忽然", category: "ai_slop" }));
    expect(res.status).toBe(201);
  });
});
