import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {}
}));

vi.mock("../../../server/context", () => ({
  getOrganizationId: () => "org-1"
}));

vi.mock("../../../server/performance-trends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/performance-trends")>();
  return {
    ...actual,
    getPerformanceTrends: vi.fn()
  };
});

import { prisma } from "@ai-novel/db";
import { GET } from "./route";
import { getPerformanceTrends } from "../../../server/performance-trends";

function trends() {
  return getPerformanceTrends as unknown as ReturnType<typeof vi.fn>;
}

describe("GET /api/performance-trends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trends().mockResolvedValue({
      scope: "organization",
      window: "30d",
      totals: { calls: 0 },
      daily: [],
      byModel: [],
      byProvider: [],
      byBillingSource: [],
      byJobType: []
    });
  });

  it("returns organization scoped performance trends", async () => {
    const res = await GET(new Request("http://localhost/api/performance-trends?window=7d"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(trends()).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1",
      window: "7d"
    });
  });

  it("defaults to 30d when window is omitted", async () => {
    await GET(new Request("http://localhost/api/performance-trends"));

    expect(trends()).toHaveBeenCalledWith(expect.objectContaining({ window: "30d" }));
  });

  it("returns 400 for invalid window", async () => {
    const res = await GET(new Request("http://localhost/api/performance-trends?window=90d"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(trends()).not.toHaveBeenCalled();
  });
});
