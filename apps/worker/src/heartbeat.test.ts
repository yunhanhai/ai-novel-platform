import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHeartbeat } from "./heartbeat";

function makePrisma() {
  return {
    workerHeartbeat: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    }
  } as never;
}

const validOrg = "00000000-0000-0000-0000-000000000001";

describe("createHeartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a heartbeat row on start", async () => {
    const prisma = makePrisma();
    const heartbeat = createHeartbeat({
      prisma,
      lockKey: "worker-1",
      organizationId: validOrg,
      pollIntervalMs: 1000,
      leaseDurationMs: 120000,
      pid: 4242
    });

    expect(heartbeat.enabled).toBe(true);
    await heartbeat.register();

    const upsert = (prisma as unknown as { workerHeartbeat: { upsert: ReturnType<typeof vi.fn> } }).workerHeartbeat.upsert;
    const args = upsert.mock.calls[0]![0] as {
      where: { lockKey: string };
      create: { organizationId: string; pid: number; pollIntervalMs: number };
      update: { pollIntervalMs: number };
    };
    expect(args.where.lockKey).toBe("worker-1");
    expect(args.create.organizationId).toBe(validOrg);
    expect(args.create.pid).toBe(4242);
    expect(args.create.pollIntervalMs).toBe(1000);
    expect(args.update.pollIntervalMs).toBe(1000);
  });

  it("updates last seen and tick status on each beat", async () => {
    const prisma = makePrisma();
    const heartbeat = createHeartbeat({
      prisma,
      lockKey: "worker-1",
      organizationId: validOrg,
      pollIntervalMs: 1000,
      leaseDurationMs: 120000
    });

    await heartbeat.beat("no_job");

    const updateMany = (prisma as unknown as { workerHeartbeat: { updateMany: ReturnType<typeof vi.fn> } }).workerHeartbeat.updateMany;
    const args = updateMany.mock.calls[0]![0] as {
      where: { lockKey: string };
      data: { lastTickStatus: string; lastSeenAt: Date };
    };
    expect(args.where.lockKey).toBe("worker-1");
    expect(args.data.lastTickStatus).toBe("no_job");
    expect(args.data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("removes the row on graceful shutdown", async () => {
    const prisma = makePrisma();
    const heartbeat = createHeartbeat({
      prisma,
      lockKey: "worker-1",
      organizationId: validOrg,
      pollIntervalMs: 1000,
      leaseDurationMs: 120000
    });

    await heartbeat.unregister();

    const deleteMany = (prisma as unknown as { workerHeartbeat: { deleteMany: ReturnType<typeof vi.fn> } }).workerHeartbeat.deleteMany;
    expect(deleteMany).toHaveBeenCalledWith({ where: { lockKey: "worker-1" } });
  });

  it("degrades to a no-op when the organization id is missing or invalid", async () => {
    for (const organizationId of [undefined, "", "not-a-uuid"]) {
      const prisma = makePrisma();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const heartbeat = createHeartbeat({
        prisma,
        lockKey: "worker-1",
        organizationId,
        pollIntervalMs: 1000,
        leaseDurationMs: 120000
      });

      expect(heartbeat.enabled).toBe(false);
      await heartbeat.register();
      await heartbeat.beat("no_job");
      await heartbeat.unregister();

      const store = (prisma as unknown as {
        workerHeartbeat: {
          upsert: ReturnType<typeof vi.fn>;
          updateMany: ReturnType<typeof vi.fn>;
          deleteMany: ReturnType<typeof vi.fn>;
        };
      }).workerHeartbeat;
      expect(store.upsert).not.toHaveBeenCalled();
      expect(store.updateMany).not.toHaveBeenCalled();
      expect(store.deleteMany).not.toHaveBeenCalled();
      warn.mockRestore();
    }
  });
});
