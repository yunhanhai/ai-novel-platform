import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { requireSession, isUnauthorizedError } from "../../../../../server/context";
import { parseReviewFeedbackProof, recordReviewFeedback, ReviewFeedbackError } from "../../../../../server/review-feedback";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 反馈表示作者采纳到编辑器的动作，不表示正文已经持久保存。
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const { organizationId, userId } = await requireSession();
    const proof = parseReviewFeedbackProof(await request.json().catch(() => null));
    if (!proof || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ success: false, error: "采纳反馈需要有效的任务、章节、来源与建议凭据" }, { status: 400 });
    }
    const data = await recordReviewFeedback({ ...proof, jobId: id, organizationId, userId, prisma });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    if (error instanceof ReviewFeedbackError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] review feedback failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
