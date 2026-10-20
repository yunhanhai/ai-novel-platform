import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";

export interface GenerationRequestInput {
  chapterId: string;
  jobType: string;
  qualityMode?: QualityMode;
  contextOptions?: ContextOptions;
  selectedText?: string;
  instruction?: string;
}

const REWRITE_POLISH_JOB_TYPES = new Set(["REWRITE", "POLISH"]);

// 构建 POST /api/generation-jobs 请求体。质量模式对全部任务生效；
// 上下文选项只在整章生成时有意义，选中改写只在 REWRITE/POLISH 时有意义，
// 其余字段一律不附加，避免污染 worker 端的 input 解析。
export function buildGenerationRequestBody(input: GenerationRequestInput): Record<string, unknown> {
  const { chapterId, jobType, qualityMode, contextOptions, selectedText, instruction } = input;
  const isRewritePolish = REWRITE_POLISH_JOB_TYPES.has(jobType);
  const trimmedInstruction = instruction?.trim();

  return {
    chapterId,
    jobType,
    ...(qualityMode ? { qualityMode } : {}),
    ...(jobType === "GENERATE_CHAPTER" && contextOptions ? { contextOptions } : {}),
    ...(isRewritePolish && selectedText
      ? {
          input: {
            selectedText,
            ...(trimmedInstruction ? { instruction: trimmedInstruction } : {})
          }
        }
      : {})
  };
}
