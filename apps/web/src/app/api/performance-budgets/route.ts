import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { requireSession } from "../../../server/context";
import { errorResponse } from "../../../server/api-errors";
import {
  BudgetValidationError,
  deactivatePerformanceBudget,
  listPerformanceBudgets,
  normalizePerformanceBudgetInput,
  upsertPerformanceBudget
} from "../../../server/performance-budgets";

export async function GET() {
  try {
    const { organizationId } = await requireSession();
    const data = await listPerformanceBudgets(organizationId, prisma);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return errorResponse("performance-budgets.GET", error);
  }
}

export async function PUT(request: Request) {
  try {
    const { organizationId } = await requireSession();
    let input: unknown;
    try { input = await request.json(); } catch { return invalid("请求必须为有效 JSON"); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("请求必须为对象");
    const body = input as Record<string, unknown>;
    if (body.scope !== "ORGANIZATION" && body.scope !== "PROJECT") return invalid("请选择组织或项目预算");
    const scope: "ORGANIZATION" | "PROJECT" = body.scope;
    const projectId = scope === "PROJECT" && typeof body.projectId === "string" ? body.projectId.trim() : undefined;
    if (scope === "PROJECT") {
      if (!projectId) return invalid("项目预算必须指定项目");
      const project = await prisma.project.findFirst({
        where: { id: projectId, organizationId, deletedAt: null }, select: { id: true }
      });
      if (!project) return NextResponse.json({ success: false, error: "项目不存在" }, { status: 404 });
    }
    const target = { prisma, organizationId, scope, ...(projectId ? { projectId } : {}) };
    if (body.clear === true) {
      const data = await deactivatePerformanceBudget(target);
      return NextResponse.json({ success: true, data, cleared: true });
    }
    const budget = normalizePerformanceBudgetInput(body);
    const data = await upsertPerformanceBudget({ ...target, ...budget });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof BudgetValidationError) return invalid(error.message);
    return errorResponse("performance-budgets.PUT", error);
  }
}

function invalid(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}
