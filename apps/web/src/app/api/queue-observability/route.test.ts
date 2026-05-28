import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganizationIdMock = vi.hoisted(() => vi.fn());
const getQueueObservabilityMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-novel/db", () => ({
  prisma: {}
}));

vi.mock("../../../server/context", () => ({
  getOrganizationId: getOrganizationIdMock
}));

vi.mock("../../../server/queue-observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/queue-observability")>();
  return {
    ...actual,
    getQueueObservability: getQueueObservabilityMock
  };
});

import { prisma } from "@ai-novel/db";
import { GET } from "./route";

describe("GET /api/queue-observability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizationIdMock.mockReturnValue("org-1");
    getQueueObservabilityMock.mockResolvedValue({
      organizationId: "org-1",
      generatedAt: "2026-05-28T10:00:00.000Z",
      totals: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
      health: { state: "idle", label: "空闲", detail: "当前没有等待或运行中的任务" },
      oldestQueued: null,
      recentJobs: []
    });
  });

  it("returns organization queue observability", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.health.state).toBe("idle");
    expect(getQueueObservabilityMock).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1"
    });
  });

  it("returns a structured error when organization context is missing", async () => {
    getOrganizationIdMock.mockImplementation(() => {
      throw new Error("DEFAULT_ORGANIZATION_ID 未配置");
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("DEFAULT_ORGANIZATION_ID");
    expect(getQueueObservabilityMock).not.toHaveBeenCalled();
  });

  it("returns a structured error when aggregation fails", async () => {
    getQueueObservabilityMock.mockRejectedValue(new Error("db unavailable"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("db unavailable");
  });
});
