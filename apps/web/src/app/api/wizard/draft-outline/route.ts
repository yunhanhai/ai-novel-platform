import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { draftOutline, type DraftOutlineInput } from "../../../../server/wizard-drafts";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

const VALID_METHODS = new Set([
  "snowflake", "three_act", "four_act",
  "webnovel_speed", "romance_rhythm", "short_reversal", "custom"
]);

interface RequestBody {
  methodType?: string;
  genreTags?: unknown;
  styleTags?: unknown;
  premise?: string;
}

function toStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      const v = item.trim();
      if (v) out.push(v);
    }
  }
  return out.length > 0 ? out : undefined;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体格式错误" },
      { status: 400 }
    );
  }

  const methodType = typeof body.methodType === "string" ? body.methodType.trim() : "";
  if (!methodType || !VALID_METHODS.has(methodType)) {
    return NextResponse.json(
      { success: false, error: "methodType 不合法" },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const input: DraftOutlineInput = {
      methodType: methodType as DraftOutlineInput["methodType"]
    };
    const genreTags = toStringArray(body.genreTags);
    if (genreTags) input.genreTags = genreTags;
    const styleTags = toStringArray(body.styleTags);
    if (styleTags) input.styleTags = styleTags;
    if (typeof body.premise === "string" && body.premise.trim()) {
      input.premise = body.premise.trim();
    }

    const result = await draftOutline(input, { prisma, organizationId });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
