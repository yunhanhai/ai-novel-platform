import { NextResponse } from "next/server";
import { prisma, createJob } from "@ai-novel/db";
import { normalizeContextOptions } from "@ai-novel/shared/context-composer/options";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import { normalizeQualityMode, normalizePerformanceBudget } from "@ai-novel/shared/generation/performance";
import type { PerformanceBudgetInput } from "@ai-novel/shared/generation/performance";
import { getOrganizationId, getUserId } from "../../../server/context";

type JobType =
  | "GENERATE_OUTLINE"
  | "GENERATE_CHAPTER"
  | "CONTINUE_CHAPTER"
  | "REWRITE"
  | "POLISH"
  | "DESLOP"
  | "REVIEW"
  | "EXTRACT_MEMORY"
  | "DIAGNOSE_CHAPTER"
  | "READER_SIMULATION"
  | "STYLE_DRIFT_CHECK"
  | "CONTINUITY_CHECK";

interface CreateJobBody {
  chapterId?: string;
  projectId?: string;
  jobType?: JobType;
  modelProfileId?: string;
  input?: Record<string, unknown>;
  contextOptions?: ContextOptions;
  qualityMode?: unknown;
  performanceBudget?: PerformanceBudgetInput;
}

const ALLOWED_JOB_TYPES: JobType[] = [
  "GENERATE_OUTLINE",
  "GENERATE_CHAPTER",
  "CONTINUE_CHAPTER",
  "REWRITE",
  "POLISH",
  "DESLOP",
  "REVIEW",
  "EXTRACT_MEMORY",
  "DIAGNOSE_CHAPTER",
  "READER_SIMULATION",
  "STYLE_DRIFT_CHECK",
  "CONTINUITY_CHECK"
];

const DIAGNOSTIC_JOB_TYPES: JobType[] = [
  "DIAGNOSE_CHAPTER",
  "READER_SIMULATION",
  "STYLE_DRIFT_CHECK",
  "CONTINUITY_CHECK"
];

function isQualityMode(value: unknown): boolean {
  return value === "fast" || value === "balanced" || value === "deep";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const chapterId = searchParams.get("chapterId");

  if (!projectId && !chapterId) {
    return NextResponse.json(
      { success: false, error: "projectId 或 chapterId 至少提供一个" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const jobs = await prisma.generationJob.findMany({
      where: {
        organizationId,
        ...(projectId ? { projectId } : {}),
        ...(chapterId
          ? { targetEntityType: "CHAPTER", targetEntityId: chapterId }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        jobType: true,
        status: true,
        progress: true,
        errorCode: true,
        errorMessage: true,
        targetEntityType: true,
        targetEntityId: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true
      }
    });
    return NextResponse.json({ success: true, data: jobs });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateJobBody;
  const { chapterId, jobType: rawJobType } = body;
  const jobType = rawJobType ?? "GENERATE_CHAPTER";

  if (!ALLOWED_JOB_TYPES.includes(jobType)) {
    return NextResponse.json(
      { success: false, error: `jobType 必须为 ${ALLOWED_JOB_TYPES.join(", ")} 之一` },
      { status: 400 }
    );
  }
  if (body.qualityMode !== undefined && !isQualityMode(body.qualityMode)) {
    return NextResponse.json(
      { success: false, error: "qualityMode 必须为 fast / balanced / deep 之一" },
      { status: 400 }
    );
  }
  if (DIAGNOSTIC_JOB_TYPES.includes(jobType) && !chapterId) {
    return NextResponse.json(
      { success: false, error: "诊断类任务必须指定 chapterId" },
      { status: 400 }
    );
  }
  if (!chapterId && !body.projectId) {
    return NextResponse.json(
      { success: false, error: "chapterId 或 projectId 必填" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const userId = getUserId();

    let projectId = body.projectId;
    let targetEntityType: "PROJECT" | "OUTLINE" | "CHAPTER" | undefined;
    let targetEntityId: string | undefined;

    if (chapterId) {
      const chapter = await prisma.chapter.findFirst({
        where: { id: chapterId, organizationId, deletedAt: null },
        select: { id: true, projectId: true }
      });
      if (!chapter) {
        return NextResponse.json({ success: false, error: "章节不存在" }, { status: 404 });
      }
      projectId = chapter.projectId;
      targetEntityType = "CHAPTER";
      targetEntityId = chapter.id;
    } else if (body.projectId) {
      targetEntityType = "PROJECT";
      targetEntityId = body.projectId;
    }

    if (!projectId) {
      return NextResponse.json({ success: false, error: "无法解析 projectId" }, { status: 400 });
    }

    const qualityMode = normalizeQualityMode(body.qualityMode);
    const input = {
      ...(body.input ?? {}),
      qualityMode,
      performanceBudget: normalizePerformanceBudget(qualityMode, body.performanceBudget),
      ...(body.contextOptions ? { contextOptions: normalizeContextOptions(body.contextOptions) } : {})
    };

    const job = await createJob({
      organizationId,
      projectId,
      userId,
      jobType,
      input: input as unknown as Parameters<typeof createJob>[0]["input"],
      ...(body.modelProfileId ? { modelProfileId: body.modelProfileId } : {}),
      ...(targetEntityType ? { targetEntityType } : {}),
      ...(targetEntityId ? { targetEntityId } : {}),
      prisma
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: job.id,
          jobType: job.jobType,
          status: job.status,
          chapterId: chapterId ?? null,
          projectId: job.projectId
        }
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "服务异常";
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
