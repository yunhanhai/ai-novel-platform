import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({getOrganizationId: async () => "org-1", isUnauthorizedError: () => false }));
vi.mock("../../../../server/budgets", () => ({ getBudgetDashboard: vi.fn() }));

import { GET } from "./route";
import { getBudgetDashboard } from "../../../../server/budgets";

const dashboard = {
  policy: null,
  period: {
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    periodEnd: new Date("2026-05-31T00:00:00.000Z"),
    periodEndExclusive: new Date("2026-06-01T00:00:00.000Z")
  },
  summary: {
    actualCostCents: 0,
    budgetCents: 0,
    remainingBudgetCents: null,
    costUsagePercent: null,
    actualTokens: 0,
    tokenQuota: 0,
    remainingTokens: null,
    tokenUsagePercent: null,
    maxUsagePercent: 0
  },
  dailyUsage: [],
  notifications: []
};

function gbd() { return getBudgetDashboard as unknown as ReturnType<typeof vi.fn>; }

describe("GET /api/usage/budget-summary", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns a budget dashboard summary", async () => {
    gbd().mockResolvedValue(dashboard);

    const res = await GET(new Request("http://localhost/api/usage/budget-summary?projectId=proj-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(gbd()).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      prisma: expect.anything()
    });
  });

  it("returns 500 when the dashboard service fails", async () => {
    gbd().mockRejectedValue(new Error("boom"));

    const res = await GET(new Request("http://localhost/api/usage/budget-summary"));

    expect(res.status).toBe(500);
  });
});
