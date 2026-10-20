// 服务端上下文：唯一真相源是登录 session（cookie），不再回落到环境变量。
// API 路由与 (app) layout 都通过这里读取 organizationId / userId。

import { getSession } from "./auth";

export interface SessionContext {
  userId: string;
  organizationId: string;
  displayName: string;
}

export class UnauthorizedError extends Error {
  constructor(message = "未登录或会话已过期") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}

export async function getSessionContext(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError();
  }
  if (!session.organizationId) {
    throw new UnauthorizedError("当前账号未归属任何组织");
  }
  return {
    userId: session.userId,
    organizationId: session.organizationId,
    displayName: session.displayName
  };
}

export async function getOrganizationId(): Promise<string> {
  return (await getSessionContext()).organizationId;
}

export async function safeGetOrganizationId(): Promise<string | null> {
  const session = await getSession();
  return session?.organizationId?.trim() || null;
}

export async function getUserId(): Promise<string> {
  return (await getSessionContext()).userId;
}

export async function safeGetUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.userId?.trim() || null;
}

// 批量更新 / 写入需要「会话 + 用户」成对出现，避免同一请求内重复读 cookie。
export async function requireSession(): Promise<SessionContext> {
  return getSessionContext();
}
