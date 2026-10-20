import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { createDeslopRule, findDeslopRulesByProject } from "../../../server/deslop-rules";
import { getOrganizationId, isUnauthorizedError } from "../../../server/context";

const RULE_TYPES = ["exact_match", "regex", "frequency", "sentence_pattern"] as const;
type RuleType = (typeof RULE_TYPES)[number];

interface CreateBody {
  projectId?: string;
  ruleType?: RuleType;
  pattern?: string;
  category?: string;
  severity?: "info" | "warning" | "error";
  suggestion?: string;
  genre?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ success: false, error: "projectId 必填" }, { status: 400 });
  }
  try {
    const organizationId = await getOrganizationId();
    const items = await findDeslopRulesByProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  if (!body.projectId || !body.pattern || !body.category || !body.ruleType) {
    return NextResponse.json(
      { success: false, error: "projectId、ruleType、pattern、category 为必填项" },
      { status: 400 }
    );
  }
  if (!RULE_TYPES.includes(body.ruleType)) {
    return NextResponse.json(
      { success: false, error: `ruleType 必须为 ${RULE_TYPES.join(", ")} 之一` },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const rule = await createDeslopRule({
      organizationId,
      projectId: body.projectId,
      ruleType: body.ruleType,
      pattern: body.pattern,
      category: body.category,
      ...(body.severity ? { severity: body.severity } : {}),
      ...(body.suggestion ? { suggestion: body.suggestion } : {}),
      ...(body.genre ? { genre: body.genre } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: rule }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] deslop-rules failed", error);
  return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
}
