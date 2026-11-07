import type { JobSummary } from "./use-workspace-data";
import { PipelineTimeline } from "./pipeline-timeline";
import { useCallback, useState } from "react";
import { ContextComposer } from "./context-composer";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";
import { parseQualityConstraints } from "@ai-novel/shared/generation/quality-constraints";
import type { QualityConstraints } from "@ai-novel/shared/generation/quality-constraints";
import {
  labelForGenerationJobStatus,
  labelForGenerationJobType,
  labelForQualityMode
} from "../../lib/display-labels";

interface AiPanelProps {
  onGenerate: (qualityMode: QualityMode, contextOptions?: ContextOptions, qualityConstraints?: QualityConstraints) => void;
  onDiagnose: (qualityMode: QualityMode) => void;
  onContinue: () => void;
  onBatchContinue: (chapterCount: number, extractMemory: boolean) => void;
  onDeslop: () => void;
  onExtractMemory: () => void;
  isStarting: boolean;
  job: JobSummary | null;
  error: string | null;
  canGenerate: boolean;
  chapterId: string | null;
  onStopJob: () => void;
  stopping: boolean;
}

const QUALITY_MODES: QualityMode[] = ["fast", "balanced", "deep"];

export function AiPanel({ onGenerate, onDiagnose, onContinue, onBatchContinue, onDeslop, onExtractMemory, isStarting, job, error, canGenerate, chapterId, onStopJob, stopping }: AiPanelProps) {
  const isRunning = job ? ["QUEUED", "RUNNING"].includes(job.status) : false;
  const [contextSelection, setContextSelection] = useState<{ chapterId: string | null; options: ContextOptions | undefined } | null>(null);
  const contextOptions = contextSelection?.chapterId === chapterId ? contextSelection.options : undefined;
  const setContextOptions = useCallback((options: ContextOptions | undefined, sourceChapterId: string | null) => {
    setContextSelection({ chapterId: sourceChapterId, options });
  }, []);
  const [qualityMode, setQualityMode] = useState<QualityMode>("balanced");
  const [minChars, setMinChars] = useState("");
  const [maxChars, setMaxChars] = useState("");
  const [requiredFacts, setRequiredFacts] = useState("");
  const [constraintError, setConstraintError] = useState<string | null>(null);
  const [batchCount, setBatchCount] = useState(3);
  const [batchExtractMemory, setBatchExtractMemory] = useState(true);
  const busy = isStarting || isRunning || !canGenerate;

  const generateLabel = isStarting && job?.jobType === "GENERATE_CHAPTER"
    ? "提交中..."
    : isRunning && job?.jobType === "GENERATE_CHAPTER"
    ? "生成中..."
    : "生成章节";
  const diagnoseLabel = isStarting && job?.jobType === "DIAGNOSE_CHAPTER"
    ? "提交中..."
    : isRunning && job?.jobType === "DIAGNOSE_CHAPTER"
    ? "诊断中..."
    : "运行诊断";
  const deslopLabel = isStarting && job?.jobType === "DESLOP" ? "提交中..." : "去 AI 味";
  const extractLabel = isStarting && job?.jobType === "EXTRACT_MEMORY" ? "提交中..." : "抽取记忆";
  const continueLabel = isStarting && job?.jobType === "CONTINUE_CHAPTER"
    ? "提交中..."
    : isRunning && job?.jobType === "CONTINUE_CHAPTER"
    ? "续写中..."
    : "继续写";
  const batchLabel = isStarting && job?.jobType === "BATCH_CONTINUE"
    ? "提交中..."
    : isRunning && job?.jobType === "BATCH_CONTINUE"
    ? `连更中... ${job.progress ?? "0"}%`
    : "自动连更";

  return (
    <div className="ai-panel-content" aria-label="AI 面板">
      <h3>AI 助手</h3>

      <div className="quality-mode" role="radiogroup" aria-label="生成质量模式">
        <span className="quality-mode-label muted">质量模式</span>
        <div className="quality-mode-options">
          {QUALITY_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={qualityMode === mode}
              className={`quality-mode-option ${qualityMode === mode ? "active" : ""}`}
              onClick={() => setQualityMode(mode)}
              disabled={busy}
            >
              {labelForQualityMode(mode)}
            </button>
          ))}
        </div>
      </div>

      <details>
        <summary>本次正文要求（可选）</summary>
        <label className="wizard-field"><span>最少字数</span><input aria-label="正文最少字数" type="number" min="1" max="20000" disabled={busy} value={minChars} onChange={e => setMinChars(e.target.value)} /></label>
        <label className="wizard-field"><span>最多字数</span><input aria-label="正文最多字数" type="number" min="1" max="20000" disabled={busy} value={maxChars} onChange={e => setMaxChars(e.target.value)} /></label>
        <label className="wizard-field"><span>必须呈现的事实或片段（每行一条）</span><textarea aria-label="正文必含片段" disabled={busy} rows={3} value={requiredFacts} onChange={e => setRequiredFacts(e.target.value)} /></label>
        <p className="muted">生成后核对字数与指定片段，情节是否成立仍需审阅。</p>
      </details>
      {constraintError && <p className="form-error" role="alert">{constraintError}</p>}
      <div className="ai-actions">
        <button
          className="btn-primary"
          onClick={() => {
            try {
              const rules = minChars || maxChars || requiredFacts.trim() ? parseQualityConstraints({
                ...(minChars ? { minChars: Number(minChars) } : {}),
                ...(maxChars ? { maxChars: Number(maxChars) } : {}),
                requiredFacts: requiredFacts.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
              }) : undefined;
              setConstraintError(null);
              onGenerate(qualityMode, contextOptions, rules);
            } catch (err) { setConstraintError(err instanceof Error ? err.message : "正文要求无效"); }
          }}
          disabled={busy}
        >
          {generateLabel}
        </button>
        <button
          className="btn-ghost"
          onClick={onContinue}
          disabled={busy}
        >
          {continueLabel}
        </button>
        <div className="batch-continue-row">
          <select
            aria-label="连更章数"
            value={batchCount}
            onChange={(e) => setBatchCount(Number(e.target.value))}
            disabled={busy}
            className="batch-continue-select"
          >
            {[2, 3, 5, 10].map((count) => (
              <option key={count} value={count}>
                {count} 章
              </option>
            ))}
          </select>
          <button
            className="btn-ghost"
            onClick={() => onBatchContinue(batchCount, batchExtractMemory)}
            disabled={busy}
            title="按当前章节连续自动续写多章，中途可停止；失败时已完成部分保留"
          >
            {batchLabel}
          </button>
        </div>
        <label
          className="batch-continue-option muted"
          title="每章续写后自动抽取摘要与角色状态，让后续章节基于最新记忆生成；关闭可省一半模型调用"
        >
          <input
            type="checkbox"
            checked={batchExtractMemory}
            onChange={(e) => setBatchExtractMemory(e.target.checked)}
            disabled={busy}
          />
          连更时维护记忆
        </label>
        <button
          className="btn-ghost"
          onClick={() => onDiagnose(qualityMode)}
          disabled={busy}
        >
          {diagnoseLabel}
        </button>
        <button
          className="btn-ghost"
          onClick={onDeslop}
          disabled={busy}
        >
          {deslopLabel}
        </button>
        <button
          className="btn-ghost"
          onClick={onExtractMemory}
          disabled={busy}
        >
          {extractLabel}
        </button>
      </div>

      {!canGenerate && <p className="muted">请先选择一个章节</p>}
      {error && <p className="form-error">{error}</p>}

      <ContextComposer
        chapterId={chapterId}
        disabled={busy}
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
          {isRunning && (
            <div className="job-status-actions">
              <button
                type="button"
                className="btn-ghost btn-small"
                onClick={onStopJob}
                disabled={stopping}
                title="停止该任务；连更会在当前章完成后停止，已写内容保留"
              >
                {stopping ? "停止中..." : "停止任务"}
              </button>
            </div>
          )}
          {job.errorMessage && <p className="form-error">{job.errorMessage}</p>}
          {job.status === "QUEUED" && (
            <p className="form-hint">
              任务排队中。若长时间无进展，请到「设置 → 模型设置」确认 worker 是否在线。
            </p>
          )}
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
