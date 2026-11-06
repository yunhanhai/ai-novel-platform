import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { requireSession } from "../../../../server/context";
import { errorResponse } from "../../../../server/api-errors";
import { getRecoveryAuditLogs, normalizeRecoveryAuditLimit } from "../../../../server/recovery-audit";

export async function GET(request: Request) {
  try {
    const { organizationId } = await requireSession();
    const limit = normalizeRecoveryAuditLimit(new URL(request.url).searchParams.get("limit"));
    if (limit === null) return NextResponse.json({ success: false, error: "limit 必须为数字" }, { status: 400 });
    const data = await getRecoveryAuditLogs({ prisma, organizationId, limit });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) { return errorResponse("recovery-audit", error); }
}