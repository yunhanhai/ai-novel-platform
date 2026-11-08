import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import { getOutline, updateOutline, deleteOutline } from "../../../../server/outlines";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  title?: string;
  summary?: string;
  status?: "PLANNED" | "DRAFTING" | "DONE";
  baseRevisionHash?: string;
}

const HASH_RE = /^[0-9a-f]{64}$/i;

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const node = await getOutline(await getOrganizationId(), id, prisma);
    if (!node) return NextResponse.json({ success: false, error: "大纲条目不存在" }, { status: 404 });
    return NextResponse.json({ success: true, data: node });
  } catch (error: unknown) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ success: false, error: "请求需要 JSON 对象" }, { status: 400 });
  }
  const body = parsed as PatchBody;
  if (typeof body.baseRevisionHash !== "string" || !HASH_RE.test(body.baseRevisionHash) ||
    Object.keys(body).some(key => !["title", "summary", "status", "baseRevisionHash"].includes(key)) ||
    (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200)) ||
    (body.summary !== undefined && typeof body.summary !== "string") ||
    (body.status !== undefined && !["PLANNED", "DRAFTING", "DONE"].includes(body.status))) {
    return NextResponse.json({ success: false, error: "大纲操作需要有效的 baseRevisionHash，标题、摘要和状态需有效" }, { status: 400 });
  }
  try {
    const organizationId = await getOrganizationId();
    const { baseRevisionHash, ...patch } = body;
    const updated = await updateOutline(organizationId, id, { ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}) }, prisma, baseRevisionHash);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || !("baseRevisionHash" in body) ||
    typeof body.baseRevisionHash !== "string" || !HASH_RE.test(body.baseRevisionHash)) {
    return NextResponse.json({ success: false, error: "删除大纲需要有效的 baseRevisionHash" }, { status: 400 });
  }
  try {
    const organizationId = await getOrganizationId();
    await deleteOutline(organizationId, id, prisma, body.baseRevisionHash);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.message === "OUTLINE_REVISION_STALE") {
    return NextResponse.json({ success: false, error: "大纲已被其他页面更新，未执行本次操作。请读取最新条目并核对后再试。" }, { status: 409 });
  }
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] outlines/[id] failed", error);
  const isNotFound = /P2025|不存在/.test(message);
  return NextResponse.json(
    { success: false, error: isNotFound ? "大纲条目不存在" : sanitizeServerMessage(message) },
    { status: isNotFound ? 404 : 500 }
  );
}
