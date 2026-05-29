import { describe, expect, it, vi } from "vitest";
import { getRecoveryAuditLogs } from "./recovery-audit";

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
  actor: { displayName: string | null; email: string } | null;
};

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "audit-1",
    action: "generation_job.retry",
    entityType: "generation_job",
    entityId: "job-1",
    metadata: { resultingStatus: "QUEUED" },
    createdAt: new Date("2026-05-29T10:00:00.000Z"),
    actor: { displayName: "Ops User", email: "ops@example.com" },
    ...overrides
  };
}

function mockPrisma(rows: AuditRow[]) {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue(rows)
    }
  } as unknown as Parameters<typeof getRecoveryAuditLogs>[0]["prisma"];
}

describe("getRecoveryAuditLogs", () => {
  it("loads organization-scoped recovery audit logs newest first", async () => {
    const prisma = mockPrisma([row()]);

    const result = await getRecoveryAuditLogs({
      prisma,
      organizationId: "org-1",
      limit: 10
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        action: { in: ["generation_job.retry", "queue.recover_expired_leases"] }
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        actor: {
          select: { displayName: true, email: true }
        }
      }
    });
    expect(result.items[0]).toMatchObject({
      id: "audit-1",
      action: "generation_job.retry",
      entityType: "generation_job",
      entityId: "job-1",
      actorDisplayName: "Ops User",
      metadata: { resultingStatus: "QUEUED" },
      createdAt: "2026-05-29T10:00:00.000Z"
    });
  });

  it("clamps limits and falls back to actor email", async () => {
    const prisma = mockPrisma([
      row({
        actor: { displayName: null, email: "fallback@example.com" },
        action: "queue.recover_expired_leases",
        entityType: "queue",
        entityId: null,
        metadata: { recovered: 2, failed: 1 }
      })
    ]);

    const result = await getRecoveryAuditLogs({
      prisma,
      organizationId: "org-1",
      limit: 999
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    expect(result.items[0]).toMatchObject({
      action: "queue.recover_expired_leases",
      actorDisplayName: "fallback@example.com",
      metadata: { recovered: 2, failed: 1 }
    });
  });

  it("drops unsafe metadata shapes", async () => {
    const prisma = mockPrisma([
      row({
        metadata: ["raw", "array"]
      })
    ]);

    const result = await getRecoveryAuditLogs({
      prisma,
      organizationId: "org-1",
      limit: 0
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    expect(result.items[0]?.metadata).toEqual({});
  });
});
