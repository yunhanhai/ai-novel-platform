import { NextResponse } from "next/server";
import { prisma, recoverExpiredJobLeases } from "@ai-novel/db";
import { getOrganizationId } from "../../../server/context";
import { getQueueObservability } from "../../../server/queue-observability";

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
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
