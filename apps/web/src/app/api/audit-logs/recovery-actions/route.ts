import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId } from "../../../../server/context";
import {
  getRecoveryAuditLogs,
  normalizeRecoveryAuditLimit
} from "../../../../server/recovery-audit";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = normalizeRecoveryAuditLimit(url.searchParams.get("limit"));

  if (limit === null) {
    return NextResponse.json(
      { success: false, error: "limit must be a number" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const data = await getRecoveryAuditLogs({
      prisma,
      organizationId,
      limit
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
