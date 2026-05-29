const PROJECT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "进行中",
  PAUSED: "已暂停",
  ARCHIVED: "已归档"
};

const CHAPTER_STATUS_LABELS: Record<string, string> = {
  PLANNED: "待写",
  DRAFT: "草稿",
  REVIEWING: "审阅中",
  FINAL: "定稿"
};

const PROVIDER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "启用中",
  DISABLED: "已停用",
  ERROR: "异常"
};

const GENERATION_JOB_TYPE_LABELS: Record<string, string> = {
  GENERATE_OUTLINE: "生成大纲",
  GENERATE_CHAPTER: "生成章节",
  CONTINUE_CHAPTER: "续写章节",
  REWRITE: "改写",
  POLISH: "润色",
  DESLOP: "去 AI 味",
  REVIEW: "审阅",
  EXTRACT_MEMORY: "抽取记忆"
};

const TASK_TYPE_LABELS: Record<string, string> = {
  default: "默认",
  generate_chapter: "生成章节",
  generate_outline: "生成大纲",
  deslop: "去 AI 味",
  extract_memory: "抽取记忆",
  rewrite: "改写",
  polish: "润色",
  review: "审阅",
  continue_chapter: "续写章节"
};

const JOB_STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "运行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  PENDING: "等待中",
  SKIPPED: "已跳过"
};

const PIPELINE_STEP_LABELS: Record<string, string> = {
  plan: "规划",
  draft: "起草",
  review: "审阅",
  revise: "修订",
  persist_version: "保存版本",
  extract_memory: "抽取记忆",
  scan_deslop: "扫描 AI 味",
  analyze_style: "分析风格"
};

function fallback(value: string): string {
  return value;
}

export function labelForProjectStatus(status: string): string {
  return PROJECT_STATUS_LABELS[status] ?? fallback(status);
}

export function labelForChapterStatus(status: string): string {
  return CHAPTER_STATUS_LABELS[status] ?? fallback(status);
}

export function labelForProviderStatus(status: string): string {
  return PROVIDER_STATUS_LABELS[status] ?? fallback(status);
}

export function labelForGenerationJobType(jobType: string): string {
  return GENERATION_JOB_TYPE_LABELS[jobType] ?? fallback(jobType);
}

export function labelForGenerationJobStatus(status: string): string {
  return JOB_STATUS_LABELS[status] ?? fallback(status);
}

export function labelForTaskType(taskType: string): string {
  return TASK_TYPE_LABELS[taskType] ?? fallback(taskType);
}

export function labelForPipelineStep(stepKey: string): string {
  return PIPELINE_STEP_LABELS[stepKey] ?? fallback(stepKey);
}
