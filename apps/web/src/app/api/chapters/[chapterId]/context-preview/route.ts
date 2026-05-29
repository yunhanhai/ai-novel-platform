import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId } from "../../../../../server/context";
import { buildChapterContextPreview } from "../../../../../server/context-preview";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";

interface RouteContext {
  params: Promise<{ chapterId: string }>;
}

interface PreviewBody {
  contextOptions?: ContextOptions;
}

export async function GET(request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  const { searchParams } = new URL(request.url);
  const rawOptions: ContextOptions = {
    ...(toBudgetPreset(searchParams.get("budgetPreset")) ? { budgetPreset: toBudgetPreset(searchParams.get("budgetPreset")) } : {}),
    excludedAssetIds: searchParams.getAll("excludedAssetIds"),
    forcedAssetIds: searchParams.getAll("forcedAssetIds")
  };
  const invalid = validateRawBudgetPreset(searchParams.get("budgetPreset")) ?? validateContextOptions(rawOptions);
  if (invalid) return invalid;
  return respondWithPreview(chapterId, rawOptions);
}

export async function POST(request: Request, context: RouteContext) {
  const { chapterId } = await context.params;
  const body = (await request.json()) as PreviewBody;
  const rawOptions = body.contextOptions ?? {};
  const invalid = validateContextOptions(rawOptions);
  if (invalid) return invalid;
  return respondWithPreview(chapterId, rawOptions);
}

function toBudgetPreset(value: string | null): ContextOptions["budgetPreset"] | undefined {
  return value === "compact" || value === "standard" || value === "rich" ? value : undefined;
}

function validateRawBudgetPreset(value: string | null): NextResponse | null {
  if (value !== null && !toBudgetPreset(value)) {
    return NextResponse.json({ success: false, error: "invalid budgetPreset" }, { status: 400 });
  }
  return null;
}

async function respondWithPreview(chapterId: string, rawOptions: ContextOptions) {
  try {
    const preview = await buildChapterContextPreview({
      organizationId: getOrganizationId(),
      chapterId,
      rawOptions,
      prisma
    });
    if (!preview) {
      return NextResponse.json({ success: false, error: "chapter not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: preview });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "service error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function validateContextOptions(options: ContextOptions): NextResponse | null {
  const preset = options.budgetPreset;
  if (preset !== undefined && preset !== "compact" && preset !== "standard" && preset !== "rich") {
    return NextResponse.json({ success: false, error: "invalid budgetPreset" }, { status: 400 });
  }
  if (options.excludedAssetIds !== undefined && !Array.isArray(options.excludedAssetIds)) {
    return NextResponse.json({ success: false, error: "excludedAssetIds must be an array" }, { status: 400 });
  }
  if (options.forcedAssetIds !== undefined && !Array.isArray(options.forcedAssetIds)) {
    return NextResponse.json({ success: false, error: "forcedAssetIds must be an array" }, { status: 400 });
  }
  return null;
}
