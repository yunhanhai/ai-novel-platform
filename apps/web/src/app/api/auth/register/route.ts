import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { createUser } from "../../../../server/users";
import { setSessionCookie } from "../../../../server/auth";

interface RegisterBody {
  email?: string;
  password?: string;
  displayName?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as RegisterBody;
  if (!body.email || !body.password || !body.displayName) {
    return NextResponse.json(
      { success: false, error: "邮箱、密码和昵称为必填项" },
      { status: 400 }
    );
  }

  if (body.password.length < 6) {
    return NextResponse.json(
      { success: false, error: "密码至少6位" },
      { status: 400 }
    );
  }

  try {
    const { user, organization } = await createUser({
      email: body.email,
      displayName: body.displayName,
      password: body.password,
      prisma
    });

    await setSessionCookie({
      userId: user.id,
      organizationId: organization.id,
      displayName: user.displayName
    });

    return NextResponse.json(
      { success: true, data: { userId: user.id, displayName: user.displayName, organizationId: organization.id } },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    const status = message.includes("已被注册") ? 409 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
