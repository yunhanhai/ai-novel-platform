import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { draftCharacters, type CharacterDraftInput } from "../../../../server/character-drafts";
import { getOrganizationId } from "../../../../server/context";

interface RequestBody {
  projectId?: string;
  count?: number;
  projectTitle?: string;
  genreTags?: unknown;
  styleTags?: unknown;
  premise?: string;
  existingNames?: unknown;
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
    const input: CharacterDraftInput = {
      count: typeof body.count === "number" ? body.count : 3
    };
    if (typeof body.projectTitle === "string" && body.projectTitle.trim()) {
      input.projectTitle = body.projectTitle.trim();
    }
    const genreTags = toStrArr(body.genreTags);
    if (genreTags) input.genreTags = genreTags;
    const styleTags = toStrArr(body.styleTags);
    if (styleTags) input.styleTags = styleTags;
    if (typeof body.premise === "string" && body.premise.trim()) {
      input.premise = body.premise.trim();
    }
    const existing = toStrArr(body.existingNames);
    if (existing) input.existingNames = existing;
    if (typeof body.extraPrompt === "string" && body.extraPrompt.trim()) {
      input.extraPrompt = body.extraPrompt.trim();
    }

    const result = await draftCharacters(input, {
      prisma,
      organizationId,
      projectId: body.projectId
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
