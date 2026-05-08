import type { JobSummary } from "./use-workspace-data";

interface Props {
  job: JobSummary;
}

const STEP_LABELS: Record<string, string> = {
  plan: "规划",
  draft: "草稿",
  review: "审稿",
  revise: "修订",
  persist_version: "保存版本",
  extract_memory: "记忆抽取",
  scan_deslop: "去 AI 味扫描",
  analyze_style: "风格统计"
};

export function PipelineTimeline({ job }: Props) {
  const steps = job.steps ?? [];
  if (steps.length === 0) {
    return (
      <p className="muted pipeline-empty">任务尚未产生步骤记录。</p>
    );
  }

  return (
    <ol className="pipeline-timeline">
      {steps.map((step) => (
        <li key={step.id} className={`pipeline-step pipeline-step-${step.status.toLowerCase()}`}>
          <div className="pipeline-step-dot" aria-hidden />
          <div className="pipeline-step-body">
            <div className="pipeline-step-header">
              <strong>{STEP_LABELS[step.stepKey] ?? step.stepKey}</strong>
              <span className={`tag tag-job tag-job-${step.status.toLowerCase()}`}>{step.status}</span>
            </div>
            <div className="pipeline-step-meta muted">
              {step.latencyMs !== null && <span>{step.latencyMs}ms</span>}
              {step.inputTokens !== null && <span>↑ {step.inputTokens}</span>}
              {step.outputTokens !== null && <span>↓ {step.outputTokens}</span>}
            </div>
            {step.errorMessage && (
              <p className="form-error pipeline-step-error">{step.errorMessage}</p>
            )}
            {step.outputPreview && (
              <details className="pipeline-step-preview">
                <summary>查看输出预览</summary>
                <pre>{step.outputPreview}</pre>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
