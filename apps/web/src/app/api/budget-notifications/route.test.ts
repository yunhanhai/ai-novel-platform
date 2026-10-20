import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({getOrganizationId: async () => "org-1", isUnauthorizedError: () => false }));
vi.mock("../../../server/budgets", () => ({
  acknowledgeBudgetNotification: vi.fn(),
  listBudgetNotifications: vi.fn()
}));

import { GET, PATCH } from "./route";
import { acknowledgeBudgetNotification, listBudgetNotifications } from "../../../server/budgets";

const notification = {
  id: "note-1",
  organizationId: "org-1",
  projectId: null,
  budgetPolicyId: "policy-1",
  dedupeKey: "policy-1:2026-05-01:80",
  periodStart: new Date("2026-05-01T00:00:00.000Z"),
  periodEnd: new Date("2026-05-31T00:00:00.000Z"),
  thresholdPercent: 80,
  actualCostCents: 8_200,
  budgetCents: 10_000,
  actualTokens: 12_000,
  tokenQuota: 20_000,
  status: "open",
  message: "本周期预算使用率已达到 80%。",
  createdAt: new Date("2026-05-20T00:00:00.000Z"),
  acknowledgedAt: null
};

function lbn() { return listBudgetNotifications as unknown as ReturnType<typeof vi.fn>; }
function abn() { return acknowledgeBudgetNotification as unknown as ReturnType<typeof vi.fn>; }

function patchRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/budget-notifications", {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

describe("GET /api/budget-notifications", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns notifications and forwards status and limit filters", async () => {
    lbn().mockResolvedValue([notification]);

    const res = await GET(new Request("http://localhost/api/budget-notifications?status=open&limit=5"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(lbn()).toHaveBeenCalledWith({
      organizationId: "org-1",
      status: "open",
      limit: 5,
      prisma: expect.anything()
    });
  });

  it("rejects unsupported status values", async () => {
    const res = await GET(new Request("http://localhost/api/budget-notifications?status=closed"));

    expect(res.status).toBe(400);
    expect(lbn()).not.toHaveBeenCalled();
  });

  it("maps service validation errors to 400", async () => {
    lbn().mockRejectedValue(new Error("limit 必须是整数"));

    const res = await GET(new Request("http://localhost/api/budget-notifications?limit=abc"));

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/budget-notifications", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when id is missing", async () => {
    const res = await PATCH(patchRequest({}));

    expect(res.status).toBe(400);
    expect(abn()).not.toHaveBeenCalled();
  });

  it("acknowledges an open notification", async () => {
    abn().mockResolvedValue({ ...notification, status: "acknowledged" });

    const res = await PATCH(patchRequest({ id: "note-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(abn()).toHaveBeenCalledWith({
      organizationId: "org-1",
      id: "note-1",
      prisma: expect.anything()
    });
    expect(json.data.status).toBe("acknowledged");
  });

  it("returns 400 when the notification is already handled or missing", async () => {
    abn().mockRejectedValue(new Error("预算通知不存在或已处理"));

    const res = await PATCH(patchRequest({ id: "note-1" }));

    expect(res.status).toBe(400);
  });
});
