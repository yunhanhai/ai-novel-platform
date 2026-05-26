import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    project: {
      findFirst: vi.fn()
    }
  }
}));

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: () => "org-1"
}));

vi.mock("../../../../../server/performance-trends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../server/performance-trends")>();
  return {
    ...actual,
    getPerformanceTrends: vi.fn()
  };
});

import { prisma } from "@ai-novel/db";
import { GET } from "./route";
import { getPerformanceTrends } from "../../../../../server/performance-trends";

function routeCtx(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function projectFindFirst() {
  return prisma.project.findFirst as unknown as ReturnType<typeof vi.fn>;
}

function trends() {
  return getPerformanceTrends as unknown as ReturnType<typeof vi.fn>;
}

describe("GET /api/projects/[projectId]/performance-trends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirst().mockResolvedValue({ id: "proj-1" });
    trends().mockResolvedValue({
      scope: "project",
      window: "7d",
      totals: { calls: 0 },
      daily: [],
      byModel: [],
      byProvider: [],
      byBillingSource: [],
      byJobType: []
    });
  });

  it("returns project scoped performance trends", async () => {
    const res = await GET(
      new Request("http://localhost/api/projects/proj-1/performance-trends?window=7d"),
      routeCtx("proj-1")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(projectFindFirst()).toHaveBeenCalledWith({
      where: { id: "proj-1", organizationId: "org-1", deletedAt: null },
      select: { id: true }
    });
    expect(trends()).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1",
      projectId: "proj-1",
      window: "7d"
    });
  });

  it("defaults to 30d when window is omitted", async () => {
    await GET(new Request("http://localhost/api/projects/proj-1/performance-trends"), routeCtx("proj-1"));

    expect(trends()).toHaveBeenCalledWith(expect.objectContaining({ window: "30d" }));
  });

  it("returns 400 for invalid window", async () => {
    const res = await GET(
      new Request("http://localhost/api/projects/proj-1/performance-trends?window=90d"),
      routeCtx("proj-1")
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(trends()).not.toHaveBeenCalled();
  });

  it("returns 404 when project is missing from the current organization", async () => {
    projectFindFirst().mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/projects/proj-2/performance-trends"), routeCtx("proj-2"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(trends()).not.toHaveBeenCalled();
  });
});
