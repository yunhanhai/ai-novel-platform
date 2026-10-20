import type { PrismaClient } from "@ai-novel/db";
import { createFakeModel } from "./fake-model";
import type { GenerationJob } from "../poll";

type FakeModel = ReturnType<typeof createFakeModel>;

type UpdateStatusFn = (params: {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}) => Promise<unknown>;

interface RewritePolishInput {
  chapterId?: unknown;
  selectedText?: unknown;
  instruction?: unknown;
}

interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
  resolveModel?: (job: GenerationJob) => Promise<FakeModel | null>;
}

const ERROR_CODES = {
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  SELECTION_MISSING: "SELECTION_MISSING",
  SELECTION_STALE: "SELECTION_STALE",
  NO_MODEL_PROFILE: "NO_MODEL_PROFILE",
  HANDLER_ERROR: "HANDLER_ERROR"
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

function buildPrompt(jobType: string, selectedText: string, instruction?: string): string {
  const task =
    jobType === "POLISH"
      ? `你是资深中文网文编辑。请润色以下选中文本，要求：
- 修正错别字、标点和语病
- 优化句式节奏，让文字更流畅自然
- 不改变情节、人物与信息量，不增删内容
- 与所在章节的叙述人称、时态、语气保持一致`
      : `你是资深中文网文作者。请重写以下选中文本，要求：
- 保持原有情节、人物、信息量完全一致
- 换一种更好的写法：更强的画面感、更自然的对话、去掉陈词滥调
- 与所在章节的叙述人称、时态、语气保持一致`;

  return [
    `${task}${instruction ? `\n- 优先满足用户的额外要求：${instruction}` : ""}`,
    "",
    "选中文本如下：",
    selectedText,
    "",
    "直接输出处理后的正文，不要任何解释、标题、前后缀或 markdown 代码块。"
  ].join("\n");
}

export function createRewritePolishHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const builtinModel = deps.model ?? createFakeModel();
  const resolveModel = deps.resolveModel;
  const fail = (jobId: string, code: ErrorCode, message: string) =>
    updateJobStatus({ jobId, status: "FAILED", errorCode: code, errorMessage: message });

  return async function handle(job: GenerationJob): Promise<void> {
    const input = (job.input ?? {}) as RewritePolishInput;

    const selectedText =
      typeof input.selectedText === "string" && input.selectedText.trim().length > 0
        ? input.selectedText
        : null;
    if (!selectedText) {
      await fail(job.id, ERROR_CODES.SELECTION_MISSING, "缺少待处理的选中文本 selectedText");
      return;
    }

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

    let model = builtinModel;
    if (resolveModel) {
      const resolved = await resolveModel(job);
      if (resolved) {
        model = resolved;
      } else if (!deps.model) {
        await fail(job.id, ERROR_CODES.NO_MODEL_PROFILE, "无法解析 ModelProfile 且未配置兜底模型");
        return;
      }
    }

    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, content: true }
    });
    if (!chapter || !chapter.content) {
      await fail(job.id, ERROR_CODES.CHAPTER_NOT_FOUND, `章节 ${chapterId} 不存在或内容为空`);
      return;
    }
    if (!chapter.content.includes(selectedText)) {
      await fail(
        job.id,
        ERROR_CODES.SELECTION_STALE,
        "选中文本已不在当前章节内容中，请刷新后重新选择"
      );
      return;
    }

    const prompt = buildPrompt(job.jobType, selectedText, instruction || undefined);
    const result = await model.generate(prompt);

    const newText = result.text.trim();
    if (!newText) {
      await fail(job.id, "HANDLER_ERROR", "模型未返回任何文本");
      return;
    }

    await updateJobStatus({
      jobId: job.id,
      status: "SUCCEEDED",
      output: {
        mode: job.jobType,
        selectedText,
        newText
      }
    });
  };
}
