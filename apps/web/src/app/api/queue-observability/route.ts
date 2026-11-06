import { NextResponse } from "next/server";
import { prisma, recoverExpiredJobLeases } from "@ai-novel/db";
import { requireSession } from "../../../server/context";
import { errorResponse } from "../../../server/api-errors";
import { getQueueObservability } from "../../../server/queue-observability";
import { recordAuditLog } from "../../../server/audit-log";

export async function GET() {
  try {
    const { organizationId } = await requireSession();
    return NextResponse.json({ success: true, data: await getQueueObservability({ prisma, organizationId }) });
  } catch (error: unknown) { return errorResponse("queue-observability", error); }
}

export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await requireSession();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "recover-expired-leases") {
      return NextResponse.json({ success: false, error: "不支持的队列操作" }, { status: 400 });
    }
    const data = await prisma.$transaction(async (tx) => {
      const result = await recoverExpiredJobLeases({ prisma: tx, organizationId });
      await recordAuditLog({ prisma: tx, organizationId, actorUserId: userId,
        action: "queue.recover_expired_leases", entityType: "queue", metadata: result });
      return result;
    });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) { return errorResponse("queue-observability", error); }
}