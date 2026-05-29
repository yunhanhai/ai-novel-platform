import { NextResponse } from "next/server";
import { prisma, recoverExpiredJobLeases } from "@ai-novel/db";
import { getOrganizationId, getUserId } from "../../../server/context";
import { getQueueObservability } from "../../../server/queue-observability";
import { recordAuditLog } from "../../../server/audit-log";

export async function GET() {
  try {
    const organizationId = getOrganizationId();
    const data = await getQueueObservability({ prisma, organizationId });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!isRecord(body) || body.action !== "recover-expired-leases") {
      return NextResponse.json({ success: false, error: "Unsupported queue observability action" }, { status: 400 });
    }

    const organizationId = getOrganizationId();
    const data = await recoverExpiredJobLeases({ prisma, organizationId });
    await recordAuditLog({
      prisma,
      organizationId,
      actorUserId: getUserId(),
      action: "queue.recover_expired_leases",
      entityType: "queue",
      metadata: {
        recovered: data.recovered,
        failed: data.failed
      }
    });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
