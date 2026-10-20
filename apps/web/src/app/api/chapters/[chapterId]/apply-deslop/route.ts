import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { applyDeslopEdit } from "../../../../../server/chapters";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ chapterId: string }>;
}

interface ApplyDeslopBody {
  nextContent?: string;
  baseContentHash?: string;
  matchedText?: string;
  category?: string;
}

const HASH_RE = /^[0-9a-f]{64}$/i;

export async function POST(request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  const body = (await request.json()) as ApplyDeslopBody;

  if (typeof body.nextContent !== "string") {
    return NextResponse.json(
      { success: false, error: "nextContent is required" },
      { status: 400 }
    );
  }
  if (typeof body.baseContentHash !== "string" || !HASH_RE.test(body.baseContentHash)) {
    return NextResponse.json(
      { success: false, error: "baseContentHash is required" },
      { status: 400 }
    );
  }

  try {
    const result = await applyDeslopEdit({
      organizationId: await getOrganizationId(),
      chapterId,
      nextContent: body.nextContent,
      baseContentHash: body.baseContentHash,
      updatedById: await getUserId(),
      matchedText: typeof body.matchedText === "string" ? body.matchedText : undefined,
      category: typeof body.category === "string" ? body.category : undefined,
      prisma
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    if (message.includes("CHAPTER_CONTENT_STALE")) {
      return NextResponse.json(
        { success: false, error: "章节内容已变化，请重新扫描后再应用" },
        { status: 409 }
      );
    }
    const status = message.includes("not found") || message.includes("不存在") ? 404 : 500;
    if (status === 500) console.error("[api] chapters/[chapterId]/apply-deslop failed", error);
    return NextResponse.json({ success: false, error: status === 500 ? sanitizeServerMessage(message) : message }, { status });
  }
}
