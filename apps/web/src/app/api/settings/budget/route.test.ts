import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../../server/budgets", () => ({
  getBudgetDashboard: vi.fn(),
  upsertBudgetPolicy: vi.fn()
}));

import { GET, PATCH } from "./route";
import { getBudgetDashboard, upsertBudgetPolicy } from "../../../../server/budgets";

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

const policy = {
  id: "policy-1",
  organizationId: "org-1",
  projectId: "proj-1",
  monthlyBudgetCents: 10_000,
  monthlyTokenQuota: 20_000,
  cycleAnchorDay: 15,
  thresholdPercents: [50, 80, 100],
  isActive: true,
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  updatedAt: new Date("2026-05-01T00:00:00.000Z")
};

function gbd() { return getBudgetDashboard as unknown as ReturnType<typeof vi.fn>; }
function ubp() { return upsertBudgetPolicy as unknown as ReturnType<typeof vi.fn>; }

function patchRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/settings/budget", {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

describe("GET /api/settings/budget", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns the budget dashboard for the organization scope", async () => {
    gbd().mockResolvedValue(dashboard);

    const res = await GET(new Request("http://localhost/api/settings/budget"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(gbd()).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: null,
      prisma: expect.anything()
    });
  });

  it("forwards the optional projectId filter", async () => {
    gbd().mockResolvedValue(dashboard);

    await GET(new Request("http://localhost/api/settings/budget?projectId=proj-1"));

    expect(gbd()).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      projectId: "proj-1"
    }));
  });

  it("returns 500 when the dashboard service fails", async () => {
    gbd().mockRejectedValue(new Error("boom"));

    const res = await GET(new Request("http://localhost/api/settings/budget"));

    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/settings/budget", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when integer fields are missing", async () => {
    const res = await PATCH(patchRequest({ monthlyBudgetCents: 1000 }));

    expect(res.status).toBe(400);
    expect(ubp()).not.toHaveBeenCalled();
  });

  it("saves the policy and refreshes the dashboard", async () => {
    ubp().mockResolvedValue(policy);
    gbd().mockResolvedValue({ ...dashboard, policy });

    const res = await PATCH(patchRequest({
      projectId: "proj-1",
      monthlyBudgetCents: 10_000,
      monthlyTokenQuota: 20_000,
      cycleAnchorDay: 15,
      thresholdPercents: [50, 80, 100]
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(ubp()).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      projectId: "proj-1",
      monthlyBudgetCents: 10_000,
      monthlyTokenQuota: 20_000,
      cycleAnchorDay: 15,
      thresholdPercents: [50, 80, 100]
    }));
    expect(gbd()).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      projectId: "proj-1"
    }));
    expect(json.data.policy.id).toBe("policy-1");
  });

  it("maps service validation errors to 400", async () => {
    ubp().mockRejectedValue(new Error("cycleAnchorDay 超出允许范围"));

    const res = await PATCH(patchRequest({
      monthlyBudgetCents: 10_000,
      monthlyTokenQuota: 20_000,
      cycleAnchorDay: 99
    }));

    expect(res.status).toBe(400);
  });
});
