import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { createFakeModel } from "./fake-model";
import { commitFinalize } from "./generate-chapter-handler";
import type { GenerationJob } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;

type UpdateStatusFn = (params: {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}) => Promise<unknown>;

interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
}

interface ContinueInput {
  chapterId?: unknown;
  targetLength?: unknown;
  instruction?: unknown;
}

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE",
  EMPTY_OUTPUT: "EMPTY_OUTPUT"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DEFAULT_TARGET_LENGTH = 600;
const MAX_TARGET_LENGTH = 3000;
export const TAIL_CONTEXT_CHARS = 1500;

export function normalizeTargetLength(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TARGET_LENGTH;
  return Math.min(Math.round(parsed), MAX_TARGET_LENGTH);
}

export function buildContinuePrompt(existingTail: string, targetLength: number, instruction?: string): string {
  return [
    "你是资深中文网文作者。下面是当前章节的结尾部分，请顺着它继续写下去。",
    "",
    "要求：",
    `- 续写约 ${targetLength} 字，与上文无缝衔接`,
    "- 严格延续已有的人称、时态、语气和文风",
    "- 不重复、不复述已有内容，不要另起新章或总结",
    "- 推动情节向前，保持人物行为与既有设定一致",
    instruction ? `- 额外要求：${instruction}` : "",
    "",
    "当前章节结尾：",
    existingTail,
    "",
    "直接从续写正文开始输出，不要任何解释、标题、前缀或 markdown 代码块。"
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function stripCodeFence(text: string): string {
  return text.replace(/^\s*```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
}

export function createContinueChapterHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const input = (job.input ?? {}) as ContinueInput;
    const chapterId =
      typeof input.chapterId === "string" && input.chapterId.length > 0
        ? input.chapterId
        : job.targetEntityType === "CHAPTER" && typeof job.targetEntityId === "string"
          ? job.targetEntityId
          : null;
    if (!chapterId) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, "无法从任务目标解析 chapterId");
      return;
    }

    const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
    const targetLength = normalizeTargetLength(input.targetLength);

    let model = builtinModel;
    let modelName = "fake-model";
    let billingSource: "PLATFORM" | "USER_KEY" = "PLATFORM";
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
        const meta = resolved as unknown as { modelName?: string; billingSource?: "PLATFORM" | "USER_KEY" };
        modelName = meta.modelName ?? modelName;
        billingSource = meta.billingSource ?? billingSource;
      } else if (!deps.model) {
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "无法解析 ModelProfile 且未配置兜底模型");
        return;
      }
    }

    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, projectId: true, organizationId: true, content: true, title: true }
    });
    if (!chapter) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, `章节 ${chapterId} 不存在或不属于当前项目`);
      return;
    }

    const existing = chapter.content ?? "";
    const existingTail = existing.slice(-TAIL_CONTEXT_CHARS);

    const result = await model.generate(buildContinuePrompt(existingTail, targetLength, instruction || undefined));
    const continuation = stripCodeFence(result.text);
    if (!continuation) {
      await fail(job.id, ERROR_CODES.EMPTY_OUTPUT, "模型未返回任何续写文本");
      return;
    }

    const separator = existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    const finalContent = `${existing}${separator}${continuation}`;

    const finalOutput = await commitFinalize({
      prisma,
      job,
      chapter,
      finalContent,
      wordCount: computeWordCount(finalContent),
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: 0,
        modelName,
        billingSource
      }
    });

    await updateJobStatus({
      jobId: job.id,
      status: "SUCCEEDED",
      output: {
        ...(finalOutput as unknown as Record<string, unknown>),
        mode: "CONTINUE_CHAPTER",
        addedChars: continuation.length,
        targetLength
      }
    });
  };
}
