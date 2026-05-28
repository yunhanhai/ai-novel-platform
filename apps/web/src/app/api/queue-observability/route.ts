import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
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
