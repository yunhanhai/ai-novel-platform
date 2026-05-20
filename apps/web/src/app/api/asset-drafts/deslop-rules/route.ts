import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { draftDeslopRules, type DeslopRuleDraftInput } from "../../../../server/deslop-rule-drafts";
import { getOrganizationId } from "../../../../server/context";

interface RequestBody {
  projectId?: string;
  count?: number;
  projectTitle?: string;
  genreTags?: unknown;
  styleTags?: unknown;
  existingPatterns?: unknown;
  focusCategory?: string;
  extraPrompt?: string;
}

function toStrArr(input: unknown): string[] | undefined {
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

const VALID_CATEGORIES = new Set([
  "stock_phrase", "weak_adverb", "abstract_noun_triple",
  "repetition", "sentence_pattern", "custom"
]);

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ success: false, error: "请求体格式错误" }, { status: 400 });
  }
  if (!body.projectId || typeof body.projectId !== "string") {
    return NextResponse.json({ success: false, error: "projectId 必填" }, { status: 400 });
  }

  try {
    const organizationId = getOrganizationId();
    const input: DeslopRuleDraftInput = {
      count: typeof body.count === "number" ? body.count : 3
    };
    if (typeof body.projectTitle === "string" && body.projectTitle.trim()) {
      input.projectTitle = body.projectTitle.trim();
    }
    const g = toStrArr(body.genreTags); if (g) input.genreTags = g;
    const s = toStrArr(body.styleTags); if (s) input.styleTags = s;
    const e = toStrArr(body.existingPatterns); if (e) input.existingPatterns = e;
    if (typeof body.focusCategory === "string" && VALID_CATEGORIES.has(body.focusCategory)) {
      input.focusCategory = body.focusCategory as DeslopRuleDraftInput["focusCategory"];
    }
    if (typeof body.extraPrompt === "string" && body.extraPrompt.trim()) {
      input.extraPrompt = body.extraPrompt.trim();
    }

    const result = await draftDeslopRules(input, {
      prisma, organizationId, projectId: body.projectId
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "服务异常" },
      { status: 500 }
    );
  }
}
