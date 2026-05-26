import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId } from "../../../server/context";
import {
  getPerformanceTrends,
  normalizePerformanceTrendWindow
} from "../../../server/performance-trends";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const window = normalizePerformanceTrendWindow(url.searchParams.get("window") ?? "30d");

  if (!window) {
    return NextResponse.json(
      { success: false, error: "window must be 7d or 30d" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const data = await getPerformanceTrends({
      prisma,
      organizationId,
      window
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "服务异常" },
      { status: 500 }
    );
  }
}
