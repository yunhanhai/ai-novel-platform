import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface FeedbackBody {
  quote?: unknown;
}

interface ReviewSuggestion {
  quote?: string;
  applied?: boolean;
  [key: string]: unknown;
}

interface JobOutput {
  review?: {
    suggestions?: ReviewSuggestion[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// 审校建议的采纳反馈：作者在对比卡里点「应用替换」时回写。
// 只记录"应用了"这一个动作——评测时未标记的条目即视为未采纳，
// 采纳率（应用数 / 建议总数）就是评审质量的行为信号。
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as FeedbackBody;
  const quote = typeof body.quote === "string" ? body.quote : "";

  if (!quote) {
    return NextResponse.json({ success: false, error: "缺少建议原文 quote" }, { status: 400 });
  }

  try {
    const organizationId = await getOrganizationId();
    const job = await prisma.generationJob.findFirst({
      where: { id, organizationId },
      select: { id: true, output: true }
    });
    if (!job) {
      return NextResponse.json({ success: false, error: "任务不存在" }, { status: 404 });
    }

    const output = (job.output ?? {}) as JobOutput;
    const suggestions = output.review?.suggestions;
    if (!Array.isArray(suggestions)) {
      return NextResponse.json(
        { success: false, error: "该任务没有结构化的审校建议" },
        { status: 400 }
      );
    }

    let matched = false;
    for (const suggestion of suggestions) {
      if (typeof suggestion.quote === "string" && suggestion.quote === quote) {
        suggestion.applied = true;
        matched = true;
        break;
      }
    }
    if (!matched) {
      return NextResponse.json({ success: false, error: "未找到匹配的建议" }, { status: 404 });
    }

    await prisma.generationJob.update({
      where: { id: job.id },
      data: { output: output as never }
    });

    return NextResponse.json({ success: true, data: { id: job.id, quote } });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] review feedback failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
