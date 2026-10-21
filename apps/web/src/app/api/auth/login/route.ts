import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { verifyPassword } from "@ai-novel/shared/auth/password";
import { setSessionCookie } from "../../../../server/auth";
import { findUserByEmail } from "../../../../server/users";
import { findOrganizationsByUserId } from "../../../../server/organizations";
import {
  LOGIN_POLICY,
  checkRateLimit,
  clearRateLimit,
  clientIpFromHeaders,
  recordFailure
} from "../../../../server/rate-limit";

interface LoginBody {
  email?: string;
  password?: string;
}

const GENERIC_CREDENTIAL_ERROR = "邮箱或密码错误";

function tooManyAttempts(retryAfterMs: number) {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  return NextResponse.json(
    { success: false, error: `尝试次数过多，请在 ${Math.ceil(retryAfterSec / 60)} 分钟后重试` },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody;
  if (!body.email || !body.password) {
    return NextResponse.json({ success: false, error: "邮箱和密码为必填项" }, { status: 400 });
  }

  const ip = clientIpFromHeaders(request.headers);
  const emailKey = `login:email:${body.email.trim().toLowerCase()}`;
  const ipKey = `login:ip:${ip}`;

  const ipCheck = checkRateLimit(ipKey, LOGIN_POLICY);
  if (!ipCheck.allowed) return tooManyAttempts(ipCheck.retryAfterMs ?? LOGIN_POLICY.blockMs);
  const emailCheck = checkRateLimit(emailKey, LOGIN_POLICY);
  if (!emailCheck.allowed) return tooManyAttempts(emailCheck.retryAfterMs ?? LOGIN_POLICY.blockMs);

  try {
    const user = await findUserByEmail(body.email, prisma);
    if (!user || !user.passwordHash) {
      recordFailure(ipKey, LOGIN_POLICY);
      recordFailure(emailKey, LOGIN_POLICY);
      return NextResponse.json({ success: false, error: GENERIC_CREDENTIAL_ERROR }, { status: 401 });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      recordFailure(ipKey, LOGIN_POLICY);
      recordFailure(emailKey, LOGIN_POLICY);
      return NextResponse.json({ success: false, error: GENERIC_CREDENTIAL_ERROR }, { status: 401 });
    }

    clearRateLimit(ipKey);
    clearRateLimit(emailKey);

    const orgs = await findOrganizationsByUserId(user.id, prisma);
    const organizationId = orgs[0]?.id ?? "";

    await setSessionCookie({
      userId: user.id,
      organizationId,
      displayName: user.displayName
    });

    return NextResponse.json({
      success: true,
      data: {
        userId: user.id,
        displayName: user.displayName,
        organizationId
      }
    });
  } catch (error: unknown) {
    console.error("[api] login failed", error);
    return NextResponse.json({ success: false, error: "服务器内部错误" }, { status: 500 });
  }
}
