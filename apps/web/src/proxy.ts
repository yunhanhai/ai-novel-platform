import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "./server/session-token";

// 请求级 API 网关：/api/** 除 /api/auth/** 外一律要求有效 session cookie。
// 路由层（server/context.getSessionContext）已有同名校验，这里是纵深防御，
// 只做 gate、不注入任何请求头。
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*"
};
