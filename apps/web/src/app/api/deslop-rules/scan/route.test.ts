import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));

vi.mock("@ai-novel/shared/deslop/scanner", () => ({
  scanDeslop: vi.fn()
}));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../../server/deslop-rules", () => ({
  findDeslopRulesByProject: vi.fn()
}));

import { POST } from "./route";
import { scanDeslop } from "@ai-novel/shared/deslop/scanner";
import { findDeslopRulesByProject } from "../../../../server/deslop-rules";

function sd() { return scanDeslop as unknown as ReturnType<typeof vi.fn>; }
function fp() { return findDeslopRulesByProject as unknown as ReturnType<typeof vi.fn>; }

describe("POST /api/deslop-rules/scan", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/deslop-rules/scan", { method: "POST", body: JSON.stringify(body) });
  }

  it("returns 400 when projectId or text missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("scans text and returns report (200)", async () => {
    fp().mockResolvedValue([]);
    sd().mockReturnValue({ issues: [], stats: { total: 0, bySeverity: {} } });
    const res = await POST(req({ projectId: "proj-1", text: "测试正文" }));
    expect(res.status).toBe(200);
  });

  it("enriches custom rules in report", async () => {
    fp().mockResolvedValue([
      { ruleType: "exact_match", pattern: "忽然", category: "ai_slop", severity: "error", suggestion: "改用'突然'" }
    ]);
    sd().mockReturnValue({
      issues: [{ category: "custom", matched: "忽然", severity: "warning", index: 0, length: 2, suggestion: null }],
      stats: { total: 1, bySeverity: { warning: 1 } }
    });
    const res = await POST(req({ projectId: "proj-1", text: "他忽然出现在门口。" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.issues[0].severity).toBe("error");
    expect(body.data.issues[0].suggestion).toBe("改用'突然'");
  });
});
