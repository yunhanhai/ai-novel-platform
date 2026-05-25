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
  analyze_style: "风格统计",
  diagnose_chapter: "章节诊断",
  reader_simulation: "读者模拟",
  style_drift_check: "风格漂移检查",
  continuity_check: "连续性检查",
  finalize: "完成"
};

export function PipelineTimeline({ job }: Props) {
  const steps = job.steps ?? [];

  return (
    <div className="pipeline-panel">
      {job.performanceSummary && (
        <div className="performance-summary-card">
          <strong>性能</strong>
          <div className="pipeline-summary-grid">
            <span>模式 {job.performanceSummary.qualityMode}</span>
            <span>调用 {job.performanceSummary.modelCalls}</span>
            <span>输入 {job.performanceSummary.inputTokens}</span>
            <span>输出 {job.performanceSummary.outputTokens}</span>
            <span>耗时 {job.performanceSummary.latencyMs}ms</span>
            <span>跳过 {job.performanceSummary.skippedSteps.length}</span>
            {job.performanceSummary.contextBudget && (
              <span>
                上下文 {job.performanceSummary.contextBudget.estimatedTokens}/
                {job.performanceSummary.contextBudget.tokenBudget}
              </span>
            )}
            {job.performanceSummary.contextBudget && (
              <span>裁剪 {job.performanceSummary.contextBudget.trimmedCount}</span>
            )}
          </div>
        </div>
      )}

      {job.diagnosticSummary && (
        <div className="diagnostic-summary-card">
          <strong>{job.diagnosticType ? STEP_LABELS[job.diagnosticType] ?? "诊断" : "诊断"}</strong>
          <div className="pipeline-summary-grid">
            <span>读者 {job.diagnosticSummary.readerScore ?? 0}</span>
            <span>风险 {job.diagnosticSummary.abandonRisk ?? "unknown"}</span>
            <span>钩子 {job.diagnosticSummary.hookStrength ?? 0}</span>
            <span>节奏 {job.diagnosticSummary.pacingScore ?? 0}</span>
            <span>风格漂移 {job.diagnosticSummary.styleDrift ?? 0}</span>
            <span>问题 {job.diagnosticSummary.continuityIssues?.length ?? 0}</span>
          </div>
          {job.diagnosticSummary.suggestions && job.diagnosticSummary.suggestions.length > 0 && (
            <ul className="diagnostic-suggestions">
              {job.diagnosticSummary.suggestions.slice(0, 3).map((suggestion, index) => (
                <li key={`${index}-${suggestion}`}>{suggestion}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {steps.length === 0 ? (
        <p className="muted pipeline-empty">任务尚未产生步骤记录。</p>
      ) : (
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
                  {step.inputTokens !== null && <span>输入 {step.inputTokens}</span>}
                  {step.outputTokens !== null && <span>输出 {step.outputTokens}</span>}
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
      )}
    </div>
  );
}
