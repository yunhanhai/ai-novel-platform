import { useState } from "react";
import type { QualityMode } from "@ai-novel/shared/generation/performance";
import type { JobSummary } from "./use-workspace-data";
import { PipelineTimeline } from "./pipeline-timeline";

interface AiPanelProps {
  onGenerate: (qualityMode: QualityMode) => void;
  onDeslop: () => void;
  onExtractMemory: () => void;
  onDiagnose: () => void;
  isStarting: boolean;
  job: JobSummary | null;
  error: string | null;
  canGenerate: boolean;
}

const QUALITY_MODES: Array<{ value: QualityMode; label: string }> = [
  { value: "fast", label: "快速" },
  { value: "balanced", label: "均衡" },
  { value: "deep", label: "深度" }
];

export function AiPanel({ onGenerate, onDeslop, onExtractMemory, onDiagnose, isStarting, job, error, canGenerate }: AiPanelProps) {
  const [qualityMode, setQualityMode] = useState<QualityMode>("balanced");
  const isRunning = job ? ["QUEUED", "RUNNING"].includes(job.status) : false;
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
      <div className="quality-mode-control" role="radiogroup" aria-label="生成质量模式">
        {QUALITY_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={qualityMode === mode.value}
            className={`quality-mode-option ${qualityMode === mode.value ? "active" : ""}`}
            onClick={() => setQualityMode(mode.value)}
            disabled={isStarting || isRunning}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="ai-actions">
        <button
          className="btn-primary"
          onClick={() => onGenerate(qualityMode)}
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
        <button
          className="btn-ghost"
          onClick={onDiagnose}
          disabled={isStarting || isRunning || !canGenerate}
        >
          诊断
        </button>
      </div>

      {!canGenerate && <p className="muted">请先选择一个章节</p>}
      {error && <p className="form-error">{error}</p>}

      {job && (
        <div className="job-status-card">
          <div className="job-status-row">
            <span className="muted">任务</span>
            <span className="job-status-id">{job.id.slice(0, 8)}</span>
          </div>
          <div className="job-status-row">
            <span className="muted">类型</span>
            <span>{job.jobType}</span>
          </div>
          <div className="job-status-row">
            <span className="muted">状态</span>
            <span className={`tag tag-job tag-job-${job.status.toLowerCase()}`}>{job.status}</span>
          </div>
          {job.errorMessage && <p className="form-error">{job.errorMessage}</p>}
          {job.performanceSummary && (
            <div className="performance-summary-mini">
              <span>{job.performanceSummary.qualityMode}</span>
              <span>{job.performanceSummary.modelCalls} 次调用</span>
              <span>{job.performanceSummary.inputTokens}/{job.performanceSummary.outputTokens} tokens</span>
              <span>{job.performanceSummary.latencyMs}ms</span>
            </div>
          )}
          {job.diagnosticSummary && (
            <div className="diagnostic-summary-mini">
              <span>读者 {job.diagnosticSummary.readerScore ?? 0}</span>
              <span>风险 {job.diagnosticSummary.abandonRisk ?? "unknown"}</span>
              <span>钩子 {job.diagnosticSummary.hookStrength ?? 0}</span>
            </div>
          )}
        </div>
      )}

      {job && <PipelineTimeline job={job} />}
    </div>
  );
}
