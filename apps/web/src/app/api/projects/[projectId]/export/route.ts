import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../../server/context";
import { sanitizeServerMessage } from "../../../../../server/api-errors";
import { buildExportFilename, collectProjectForExport, renderPlainText } from "../../../../../server/export-book";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const organizationId = await getOrganizationId();
    const book = await collectProjectForExport({ organizationId, projectId, prisma });
    if (!book) {
      return NextResponse.json({ success: false, error: "作品不存在" }, { status: 404 });
    }
    if (book.chapters.length === 0) {
      return NextResponse.json({ success: false, error: "作品还没有章节，无法导出" }, { status: 400 });
    }

    const text = renderPlainText(book);
    const filename = encodeURIComponent(buildExportFilename(book));

    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="book.txt"; filename*=UTF-8''${filename}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] project export failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
