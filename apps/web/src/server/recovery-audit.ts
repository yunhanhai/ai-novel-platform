import type { Prisma, PrismaClient } from "@ai-novel/db";

export type RecoveryAuditAction = "generation_job.retry" | "queue.recover_expired_leases";

export interface RecoveryAuditItem {
  id: string;
  action: RecoveryAuditAction;
  entityType: string;
  entityId: string | null;
  actorDisplayName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecoveryAuditList {
  items: RecoveryAuditItem[];
  total: number;
}

interface GetRecoveryAuditLogsParams {
  prisma: PrismaClient;
  organizationId: string;
  limit?: number;
}

const RECOVERY_ACTIONS: RecoveryAuditAction[] = [
  "generation_job.retry",
  "queue.recover_expired_leases"
];

export async function getRecoveryAuditLogs(params: GetRecoveryAuditLogsParams): Promise<RecoveryAuditList> {
  const take = clampLimit(params.limit);
  const rows = await params.prisma.auditLog.findMany({
    where: {
      organizationId: params.organizationId,
      action: { in: RECOVERY_ACTIONS }
    },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      actor: {
        select: { displayName: true, email: true }
      }
    }
  });

  const items = rows.map((row) => ({
    id: row.id,
    action: normalizeRecoveryAction(row.action),
    entityType: row.entityType,
    entityId: row.entityId,
    actorDisplayName: row.actor?.displayName || row.actor?.email || null,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.createdAt.toISOString()
  }));

  return {
    items,
    total: items.length
  };
}

export function normalizeRecoveryAuditLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return 10;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  return clampLimit(parsed);
}

function clampLimit(value: unknown): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 10;
  return Math.min(50, Math.max(1, parsed));
}

function normalizeRecoveryAction(action: string): RecoveryAuditAction {
  return RECOVERY_ACTIONS.includes(action as RecoveryAuditAction)
    ? action as RecoveryAuditAction
    : "generation_job.retry";
}

function normalizeMetadata(metadata: Prisma.JsonValue | null): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const safe: Record<string, unknown> = {};
  if (metadata.resultingStatus === "QUEUED") safe.resultingStatus = "QUEUED";
  for (const key of ["recovered", "failed"] as const) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
  }
  return safe;
}
