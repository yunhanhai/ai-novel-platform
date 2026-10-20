// API 统一错误映射：
// - UnauthorizedError -> 401，不回传内部细节
// - 数据库/未知异常 -> 500，仅回通用文案，详情留在服务端日志（避免泄露 DB host/port）
// - 校验类业务错误由各路由自行返回 400

import { NextResponse } from "next/server";
import { isUnauthorizedError } from "./context";

const UNAUTHORIZED_MESSAGE = "未登录或会话已过期";
const INTERNAL_MESSAGE = "服务器内部错误";

export function unauthorizedResponse(message = UNAUTHORIZED_MESSAGE) {
  return NextResponse.json({ success: false, error: message }, { status: 401 });
}

export function internalErrorResponse(context: string, error: unknown) {
  console.error(`[api] ${context} failed`, error);
  return NextResponse.json({ success: false, error: INTERNAL_MESSAGE }, { status: 500 });
}

export function errorResponse(context: string, error: unknown, fallbackMessage?: string) {
  if (isUnauthorizedError(error)) {
    return unauthorizedResponse(error.message);
  }
  if (fallbackMessage) {
    console.error(`[api] ${context} failed`, error);
    const message = error instanceof Error ? error.message : fallbackMessage;
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
  return internalErrorResponse(context, error);
}
