import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) =>
    error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("@ai-novel/db", () => ({
  prisma: { workerHeartbeat: { findMany: vi.fn() } }
}));

import { GET } from "./route";
import { getOrganizationId } from "../../../../server/context";
import { prisma } from "@ai-novel/db";

function p() {
  return prisma as unknown as { workerHeartbeat: { findMany: ReturnType<typeof vi.fn> } };
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lockKey: "worker-1",
    pid: 123,
    startedAt: new Date(),
    lastSeenAt: new Date(),
    pollIntervalMs: 1000,
    leaseDurationMs: 120000,
    lastTickStatus: "no_job",
    lastTickAt: new Date(),
    ...overrides
  };
}

describe("GET /api/worker/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the session is missing", async () => {
    const unauthorized = new Error("未登录");
    unauthorized.name = "UnauthorizedError";
    vi.mocked(getOrganizationId).mockRejectedValueOnce(unauthorized);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("reports anyOnline=true for a fresh heartbeat", async () => {
    p().workerHeartbeat.findMany.mockResolvedValue([row()]);

    const res = await GET();
    const body = (await res.json()) as { data: { anyOnline: boolean; workers: Array<{ online: boolean }> } };

    expect(res.status).toBe(200);
    expect(body.data.anyOnline).toBe(true);
    expect(body.data.workers[0]!.online).toBe(true);
  });

  it("reports anyOnline=false when the heartbeat is stale", async () => {
    p().workerHeartbeat.findMany.mockResolvedValue([
      row({ lastSeenAt: new Date(Date.now() - 60_000) })
    ]);

    const res = await GET();
    const body = (await res.json()) as { data: { anyOnline: boolean } };

    expect(body.data.anyOnline).toBe(false);
  });

  it("treats a missing worker list as offline", async () => {
    p().workerHeartbeat.findMany.mockResolvedValue([]);

    const res = await GET();
    const body = (await res.json()) as { data: { anyOnline: boolean; workers: unknown[] } };

    expect(body.data.anyOnline).toBe(false);
    expect(body.data.workers).toEqual([]);
  });

  it("queries deployment-wide heartbeats without an organization filter", async () => {
    p().workerHeartbeat.findMany.mockResolvedValue([]);

    await GET();

    const args = p().workerHeartbeat.findMany.mock.calls[0]![0] as { where?: { lastSeenAt?: { gte?: Date } } };
    expect(args.where?.lastSeenAt?.gte).toBeInstanceOf(Date);
  });
});
