import { describe, expect, it, vi } from "vitest";
import { recordAuditLog } from "./audit-log";

function mockPrisma() {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" })
    }
  } as unknown as Parameters<typeof recordAuditLog>[0]["prisma"];
}

describe("recordAuditLog", () => {
  it("writes an organization-scoped audit log with actor and metadata", async () => {
    const prisma = mockPrisma();

    await recordAuditLog({
      prisma,
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "generation_job.retry",
      entityType: "generation_job",
      entityId: "job-1",
      metadata: { previousStatus: "FAILED" }
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "generation_job.retry",
        entityType: "generation_job",
        entityId: "job-1",
        metadata: { previousStatus: "FAILED" }
      }
    });
  });

  it("omits optional fields when they are not present", async () => {
    const prisma = mockPrisma();

    await recordAuditLog({
      prisma,
      organizationId: "org-1",
      action: "queue.recover_expired_leases",
      entityType: "queue"
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        actorUserId: null,
        action: "queue.recover_expired_leases",
        entityType: "queue",
        entityId: null
      }
    });
  });
});
