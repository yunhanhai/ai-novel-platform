import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import {
  createWorldItem,
  findWorldItemsByProject
} from "../../../server/writing-assets";
import { getOrganizationId, getUserId } from "../../../server/context";

const ITEM_TYPES = [
  "location", "faction", "artifact", "rule",
  "power_system", "timeline_event", "creature", "other"
] as const;
type ItemType = (typeof ITEM_TYPES)[number];

interface CreateBody {
  projectId?: string;
  name?: string;
  itemType?: ItemType;
  aliases?: string[];
  summary?: string;
  detail?: string;
  constraints?: string;
  activationKeywords?: string[];
  priority?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ success: false, error: "projectId 必填" }, { status: 400 });
  }
  try {
    const organizationId = getOrganizationId();
    const items = await findWorldItemsByProject(organizationId, projectId, prisma);
    return NextResponse.json({ success: true, data: items });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  if (!body.projectId || !body.name || !body.itemType) {
    return NextResponse.json(
      { success: false, error: "projectId、name、itemType 为必填项" },
      { status: 400 }
    );
  }
  if (!ITEM_TYPES.includes(body.itemType)) {
    return NextResponse.json(
      { success: false, error: `itemType 必须为 ${ITEM_TYPES.join(", ")} 之一` },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const createdById = getUserId();
    const item = await createWorldItem({
      organizationId,
      projectId: body.projectId,
      itemType: body.itemType,
      name: body.name,
      createdById,
      ...(body.aliases ? { aliases: body.aliases } : {}),
      ...(body.summary ? { summary: body.summary } : {}),
      ...(body.detail ? { detail: body.detail } : {}),
      ...(body.constraints ? { constraints: body.constraints } : {}),
      ...(body.activationKeywords ? { activationKeywords: body.activationKeywords } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      prisma
    });
    return NextResponse.json({ success: true, data: item }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
