import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "./server/auth";

const COOKIE_NAME = "session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const requestHeaders = new Headers(request.headers);

  if (token) {
    const session = await verifySession(token);
    if (session) {
      requestHeaders.set("x-mvp-user-id", session.userId);
      requestHeaders.set("x-mvp-organization-id", session.organizationId);
      requestHeaders.set("x-mvp-display-name", session.displayName);
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders }
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)"
  ]
};
