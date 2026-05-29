import type { JobSummary } from "./use-workspace-data";
import { PipelineTimeline } from "./pipeline-timeline";
import { useState } from "react";
import { ContextComposer } from "./context-composer";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import {
  labelForGenerationJobStatus,
  labelForGenerationJobType
} from "../../lib/display-labels";

interface AiPanelProps {
  onGenerate: (contextOptions?: ContextOptions) => void;
  onDeslop: () => void;
  onExtractMemory: () => void;
  isStarting: boolean;
  job: JobSummary | null;
  error: string | null;
  canGenerate: boolean;
  chapterId: string | null;
}

export function AiPanel({ onGenerate, onDeslop, onExtractMemory, isStarting, job, error, canGenerate, chapterId }: AiPanelProps) {
  const isRunning = job ? ["QUEUED", "RUNNING"].includes(job.status) : false;
  const [contextOptions, setContextOptions] = useState<ContextOptions | undefined>(undefined);
  const generateLabel = isStarting && job?.jobType === "GENERATE_CHAPTER"
    ? "提交中..."
    : isRunning && job?.jobType === "GENERATE_CHAPTER"
    ? "生成中..."
    : "生成章节";
  const deslopLabel = isStarting && job?.jobType === "DESLOP" ? "提交中..." : "去 AI 味";
  const extractLabel = isStarting && job?.jobType === "EXTRACT_MEMORY" ? "提交中..." : "抽取记忆";

  return (
    <div className="ai-panel-content" aria-label="AI 面板">
      <h3>AI 助手</h3>
      <div className="ai-actions">
        <button
          className="btn-primary"
          onClick={() => onGenerate(contextOptions)}
          disabled={isStarting || isRunning || !canGenerate}
        >
          {generateLabel}
        </button>
        <button
          className="btn-ghost"
          onClick={onDeslop}
          disabled={isStarting || isRunning || !canGenerate}
        >
          {deslopLabel}
        </button>
        <button
          className="btn-ghost"
          onClick={onExtractMemory}
          disabled={isStarting || isRunning || !canGenerate}
        >
          {extractLabel}
        </button>
      </div>

      {!canGenerate && <p className="muted">请先选择一个章节</p>}
      {error && <p className="form-error">{error}</p>}

      <ContextComposer
        chapterId={chapterId}
        disabled={isStarting || isRunning || !canGenerate}
        onChange={setContextOptions}
      />

      {job && (
        <div className="job-status-card">
          <div className="job-status-row">
            <span className="muted">任务</span>
            <span className="job-status-id">{job.id.slice(0, 8)}</span>
          </div>
          <div className="job-status-row">
            <span className="muted">类型</span>
            <span>{labelForGenerationJobType(job.jobType)}</span>
          </div>
          <div className="job-status-row">
            <span className="muted">状态</span>
            <span className={`tag tag-job tag-job-${job.status.toLowerCase()}`}>
              {labelForGenerationJobStatus(job.status)}
            </span>
          </div>
          {job.errorMessage && <p className="form-error">{job.errorMessage}</p>}
          {job.output?.contextSummary && (
            <div className="context-job-summary">
              <span>上下文 {job.output.contextSummary.budgetPreset}</span>
              <span>已选 {job.output.contextSummary.includedCount}</span>
              <span>强制 {job.output.contextSummary.forcedCount}</span>
              <span>排除 {job.output.contextSummary.excludedCount}</span>
              <span>裁剪 {job.output.contextSummary.trimmedCount}</span>
            </div>
          )}
        </div>
      )}

      {job && <PipelineTimeline job={job} />}
    </div>
  );
}
