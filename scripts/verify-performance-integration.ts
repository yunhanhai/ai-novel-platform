import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, retryFailedJob, recoverExpiredJobLeases } from "../packages/db/src/index";
import { recordAuditLog } from "../apps/web/src/server/audit-log";

async function main() {
const rollback = new Error("verification-only rollback");
const evidence: string[] = [];
try {
  await prisma.$transaction(async tx => {
    const userId = randomUUID(), orgId = randomUUID(), projectId = randomUUID();
    await tx.user.create({ data: { id: userId, email: `db-verify-${userId}@example.com`, displayName: "数据库事务验收" } });
    await tx.organization.create({ data: { id: orgId, name: "事务验收", slug: `verify-${orgId}`, ownerUserId: userId } });
    await tx.project.create({ data: { id: projectId, organizationId: orgId, title: "事务验收项目", slug: `verify-${projectId}`, createdById: userId } });

    async function rejectsConstraint(name: string, operation: () => Promise<unknown>) {
      await tx.$executeRawUnsafe("SAVEPOINT verify_constraint");
      let rejected = false;
      try { await operation(); } catch { rejected = true; }
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT verify_constraint");
      assert.ok(rejected, name);
      evidence.push(name);
    }
    await rejectsConstraint("negative budget rejected by real DB CHECK", () => tx.performanceBudget.create({ data: { organizationId: orgId, scope: "ORGANIZATION", warningCents: -1 } }));
    await rejectsConstraint("reversed thresholds rejected by real DB CHECK", () => tx.performanceBudget.create({ data: { organizationId: orgId, scope: "ORGANIZATION", warningCents: 900, criticalCents: 500 } }));
    await rejectsConstraint("project scope without project rejected by real DB CHECK", () => tx.performanceBudget.create({ data: { organizationId: orgId, scope: "PROJECT", warningCents: 100 } }));
    await tx.performanceBudget.create({ data: { organizationId: orgId, scope: "ORGANIZATION", warningCents: 500 } });
    await rejectsConstraint("duplicate active organization budget rejected by real unique index", () => tx.performanceBudget.create({ data: { organizationId: orgId, scope: "ORGANIZATION", warningCents: 600 } }));

    const job = await tx.generationJob.create({ data: { organizationId: orgId, projectId, userId, jobType: "GENERATE_CHAPTER", status: "FAILED", attemptCount: 3, maxAttempts: 3, input: {} } });
    assert.deepEqual(await retryFailedJob({ prisma: tx, organizationId: randomUUID(), jobId: job.id }), { ok: false, reason: "not_found" });
    evidence.push("cross-organization retry cannot find job");
    await tx.$executeRawUnsafe("SAVEPOINT verify_audit");
    const retried = await retryFailedJob({ prisma: tx, organizationId: orgId, jobId: job.id });
    assert.equal(retried.ok, true);
    let auditFailed = false;
    try { await recordAuditLog({ prisma: tx, organizationId: orgId, actorUserId: randomUUID(), action: "generation_job.retry", entityType: "generation_job", entityId: job.id }); } catch { auditFailed = true; }
    assert.equal(auditFailed, true);
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT verify_audit");
    assert.equal((await tx.generationJob.findUniqueOrThrow({ where: { id: job.id } })).status, "FAILED");
    evidence.push("failed audit FK and transaction rollback preserve original FAILED status");
    assert.equal((await retryFailedJob({ prisma: tx, organizationId: orgId, jobId: job.id })).ok, true);
    const queued = await tx.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(queued.attemptCount, 0);
    await recordAuditLog({ prisma: tx, organizationId: orgId, actorUserId: userId, action: "generation_job.retry", entityType: "generation_job", entityId: job.id, metadata: { resultingStatus: "QUEUED" } });
    assert.equal(await tx.auditLog.count({ where: { organizationId: orgId } }), 1);
    evidence.push("successful retry resets attempts and writes audit within same transaction");
    const expired = await tx.generationJob.create({ data: { organizationId: orgId, projectId, userId, jobType: "GENERATE_CHAPTER", status: "RUNNING", attemptCount: 1, maxAttempts: 3, leaseExpiresAt: new Date(0), lockKey: "verification-only", input: {} } });
    assert.deepEqual(await recoverExpiredJobLeases({ prisma: tx, organizationId: orgId }), { recovered: 1, failed: 0 });
    assert.equal((await tx.generationJob.findUniqueOrThrow({ where: { id: expired.id } })).status, "QUEUED");
    evidence.push("expired lease recovery uses actual database state");
    throw rollback;
  }, { timeout: 30000 });
} catch (error) { if (error !== rollback) throw error; }
finally { await prisma.$disconnect(); }
console.log(JSON.stringify({ checks: evidence.length, evidence, fixtures: "rolled back", database: "existing ai_novel_platform" }, null, 2));

}
main().catch(error => { console.error(error); process.exitCode = 1; });
