import { describe, expect, it, vi } from "vitest";
import { listWorkerHeartbeats, upsertWorkerHeartbeat } from "./worker-heartbeats";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    workerHeartbeat: {
      upsert: vi.fn(),
      findMany: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof upsertWorkerHeartbeat>[0]["prisma"];
}

const heartbeat = {
  id: "heartbeat-1",
  organizationId: "org-1",
  lockKey: "worker-123",
  pid: 123,
  startedAt: new Date("2026-05-28T10:00:00.000Z"),
  lastSeenAt: new Date("2026-05-28T10:00:05.000Z"),
  pollIntervalMs: 1000,
  leaseDurationMs: 120000,
  lastTickStatus: "processed",
  lastTickAt: new Date("2026-05-28T10:00:04.000Z"),
  metadata: { host: "local" },
  createdAt: new Date("2026-05-28T10:00:00.000Z"),
  updatedAt: new Date("2026-05-28T10:00:05.000Z")
};

describe("worker-heartbeats", () => {
  it("upserts heartbeat by lock key and refreshes last seen time", async () => {
    const upsert = vi.fn().mockResolvedValue(heartbeat);
    const prisma = mockPrisma({ workerHeartbeat: { upsert, findMany: vi.fn() } });

    const result = await upsertWorkerHeartbeat({
      organizationId: "org-1",
      lockKey: "worker-123",
      pid: 123,
      startedAt: new Date("2026-05-28T10:00:00.000Z"),
      lastSeenAt: new Date("2026-05-28T10:00:05.000Z"),
      pollIntervalMs: 1000,
      leaseDurationMs: 120000,
      lastTickStatus: "processed",
      lastTickAt: new Date("2026-05-28T10:00:04.000Z"),
      metadata: { host: "local" },
      prisma
    });

    expect(result).toBe(heartbeat);
    expect(upsert).toHaveBeenCalledWith({
      where: { lockKey: "worker-123" },
      create: expect.objectContaining({
        organizationId: "org-1",
        lockKey: "worker-123",
        pid: 123,
        startedAt: new Date("2026-05-28T10:00:00.000Z"),
        lastSeenAt: new Date("2026-05-28T10:00:05.000Z"),
        pollIntervalMs: 1000,
        leaseDurationMs: 120000,
        lastTickStatus: "processed",
        lastTickAt: new Date("2026-05-28T10:00:04.000Z"),
        metadata: { host: "local" }
      }),
      update: expect.objectContaining({
        organizationId: "org-1",
        pid: 123,
        lastSeenAt: new Date("2026-05-28T10:00:05.000Z"),
        pollIntervalMs: 1000,
        leaseDurationMs: 120000,
        lastTickStatus: "processed",
        lastTickAt: new Date("2026-05-28T10:00:04.000Z"),
        metadata: { host: "local" }
      })
    });
  });

  it("lists recent worker heartbeats for one organization", async () => {
    const findMany = vi.fn().mockResolvedValue([heartbeat]);
    const prisma = mockPrisma({ workerHeartbeat: { upsert: vi.fn(), findMany } });

    const result = await listWorkerHeartbeats({
      organizationId: "org-1",
      take: 12,
      prisma
    });

    expect(result).toEqual([heartbeat]);
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { lastSeenAt: "desc" },
      take: 12
    });
  });
});
