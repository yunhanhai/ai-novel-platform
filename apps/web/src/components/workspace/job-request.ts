import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";

export interface GenerationRequestInput {
  chapterId: string;
  jobType: string;
  qualityMode?: QualityMode;
  contextOptions?: ContextOptions;
}

// 构建 POST /api/generation-jobs 请求体。质量模式对生成与诊断均生效；
// 上下文选项只对 GENERATE_CHAPTER 有意义，其余 jobType 一律不附带。
export function buildGenerationRequestBody(input: GenerationRequestInput): Record<string, unknown> {
  const { chapterId, jobType, qualityMode, contextOptions } = input;
  return {
    chapterId,
    jobType,
    ...(qualityMode ? { qualityMode } : {}),
    ...(jobType === "GENERATE_CHAPTER" && contextOptions ? { contextOptions } : {})
  };
}
