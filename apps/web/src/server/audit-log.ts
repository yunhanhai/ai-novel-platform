import type { Prisma, PrismaClient } from "@ai-novel/db";

interface RecordAuditLogParams {
  prisma: Pick<PrismaClient, "auditLog">;
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAuditLog(params: RecordAuditLogParams) {
  return params.prisma.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      ...(params.metadata === undefined ? {} : { metadata: params.metadata })
    }
  });
}
