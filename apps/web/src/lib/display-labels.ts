type GenerationJobType =
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

const GENERATION_JOB_TYPE_LABELS: Record<GenerationJobType, string> = {
  GENERATE_OUTLINE: "生成大纲",
  GENERATE_CHAPTER: "生成章节",
  CONTINUE_CHAPTER: "续写章节",
  REWRITE: "重写",
  POLISH: "润色",
  DESLOP: "去 AI 味",
  REVIEW: "审稿",
  EXTRACT_MEMORY: "抽取记忆",
  DIAGNOSE_CHAPTER: "质量诊断",
  READER_SIMULATION: "读者模拟",
  STYLE_DRIFT_CHECK: "风格漂移",
  CONTINUITY_CHECK: "连续性检查"
};

export function labelForGenerationJobType(jobType: string): string {
  return isGenerationJobType(jobType) ? GENERATION_JOB_TYPE_LABELS[jobType] : jobType;
}

function isGenerationJobType(value: string): value is GenerationJobType {
  return value in GENERATION_JOB_TYPE_LABELS;
}
