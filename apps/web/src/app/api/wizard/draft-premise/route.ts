import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { draftPremise, type DraftPremiseInput } from "../../../../server/wizard-drafts";
import { getOrganizationId } from "../../../../server/context";

interface RequestBody {
  projectTitle?: string;
  genreTags?: unknown;
  styleTags?: unknown;
  methodType?: string;
  oneLiner?: string;
  keyElements?: string;
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

  try {
    const organizationId = getOrganizationId();
    const input: DraftPremiseInput = {};
    if (typeof body.projectTitle === "string" && body.projectTitle.trim()) {
      input.projectTitle = body.projectTitle.trim();
    }
    const genreTags = toStringArray(body.genreTags);
    if (genreTags) input.genreTags = genreTags;
    const styleTags = toStringArray(body.styleTags);
    if (styleTags) input.styleTags = styleTags;
    if (typeof body.methodType === "string" && body.methodType.trim()) {
      input.methodType = body.methodType.trim() as DraftPremiseInput["methodType"];
    }
    if (typeof body.oneLiner === "string" && body.oneLiner.trim()) {
      input.oneLiner = body.oneLiner.trim();
    }
    if (typeof body.keyElements === "string" && body.keyElements.trim()) {
      input.keyElements = body.keyElements.trim();
    }

    const result = await draftPremise(input, { prisma, organizationId });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
