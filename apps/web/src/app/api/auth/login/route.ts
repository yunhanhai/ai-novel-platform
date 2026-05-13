import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { verifyPassword } from "@ai-novel/shared/auth/password";
import { setSessionCookie } from "../../../../server/auth";
import { findUserByEmail } from "../../../../server/users";
import { findOrganizationsByUserId } from "../../../../server/organizations";

interface LoginBody {
  email?: string;
  password?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody;
  if (!body.email || !body.password) {
    return NextResponse.json({ success: false, error: "邮箱和密码为必填项" }, { status: 400 });
  }

  try {
    const user = await findUserByEmail(body.email, prisma);
    if (!user || !user.passwordHash) {
      return NextResponse.json({ success: false, error: "邮箱或密码错误" }, { status: 401 });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ success: false, error: "邮箱或密码错误" }, { status: 401 });
    }

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
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
