import { NextResponse } from "next/server";
import { sanitizeServerMessage } from "../../../server/api-errors";
import { prisma } from "@ai-novel/db";
import {
  createProvider,
  findProvidersByOrganization
} from "../../../server/model-providers";
import { getOrganizationId, getUserId, isUnauthorizedError } from "../../../server/context";

const VALID_PROVIDER_TYPES = new Set([
  "OPENAI_COMPATIBLE", "ANTHROPIC", "GEMINI", "DEEPSEEK", "CUSTOM"
]);

interface CreateBody {
  name?: string;
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  isDefault?: boolean;
}

export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const providers = await findProvidersByOrganization(organizationId, prisma);
    return NextResponse.json({ success: true, data: providers });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  const { name, providerType, baseUrl, apiKey } = body;

  if (!name || !providerType || !apiKey) {
    return NextResponse.json(
      { success: false, error: "name、providerType、apiKey 为必填项" },
      { status: 400 }
    );
  }
  if (!VALID_PROVIDER_TYPES.has(providerType)) {
    return NextResponse.json(
      { success: false, error: "providerType 不在允许列表" },
      { status: 400 }
    );
  }
  if (!process.env.ENCRYPTION_KEY) {
    return NextResponse.json(
      { success: false, error: "ENCRYPTION_KEY 未配置" },
      { status: 400 }
    );
  }

  try {
    const organizationId = await getOrganizationId();
    const ownerUserId = await getUserId();
    const provider = await createProvider({
      organizationId,
      ownerUserId,
      name,
      providerType: providerType as "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "CUSTOM",
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: provider }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "服务异常";
  console.error("[api] model-providers failed", error);
  return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
}
