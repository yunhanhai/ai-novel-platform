import type { JobSummary } from "./use-workspace-data";
import {
  labelForAbandonRisk,
  labelForGenerationJobStatus,
  labelForPipelineStep,
  labelForQualityMode,
  labelForSkipReason
} from "../../lib/display-labels";

interface Props {
  job: JobSummary;
}

export function PipelineTimeline({ job }: Props) {
  const steps = job.steps ?? [];
  const perf = job.output?.performanceSummary;
  const diag = job.output?.diagnosticSummary;

  return (
    <div className="pipeline-panel">
      {perf && (
        <div className="perf-summary" aria-label="性能摘要">
          <div className="perf-summary-head">
            <strong>性能</strong>
            <span className="tag tag-quality">{labelForQualityMode(perf.qualityMode)}</span>
          </div>
          <div className="perf-summary-metrics muted">
            <span>模型调用 {perf.modelCalls}</span>
            <span>输入 {perf.inputTokens}</span>
            <span>输出 {perf.outputTokens}</span>
            <span>{perf.latencyMs}ms</span>
            {perf.skippedSteps && perf.skippedSteps.length > 0 && (
              <span>跳过 {perf.skippedSteps.length} 步</span>
            )}
          </div>
          {perf.skippedSteps && perf.skippedSteps.length > 0 && (
            <ul className="perf-skipped muted">
              {perf.skippedSteps.map((s, i) => (
                <li key={`${s.stepKey}-${i}`}>
                  {labelForPipelineStep(s.stepKey)}：{labelForSkipReason(s.reason)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {diag && (
        <div className="diagnostic-summary" aria-label="质量诊断结果">
          <div className="diagnostic-summary-head">
            <strong>质量诊断</strong>
            {job.output?.diagnosticDegraded && <span className="tag tag-warning">已降级</span>}
            <span className={`tag tag-risk tag-risk-${diag.abandonRisk}`}>
              弃书风险 {labelForAbandonRisk(diag.abandonRisk)}
            </span>
          </div>
          <div className="diagnostic-scores muted">
            <span>读者评分 {diag.readerScore}</span>
            <span>钩子 {diag.hookStrength}</span>
            <span>节奏 {diag.pacingScore}</span>
            <span>风格漂移 {diag.styleDrift}</span>
          </div>
          {diag.suggestions && diag.suggestions.length > 0 && (
            <ul className="diagnostic-suggestions">
              {diag.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          {diag.continuityIssues && diag.continuityIssues.length > 0 && (
            <ul className="diagnostic-issues">
              {diag.continuityIssues.map((issue, i) => (
                <li key={i} className={`diagnostic-issue diagnostic-issue-${issue.severity}`}>
                  <span className="diagnostic-issue-detail">{issue.detail}</span>
                  {issue.suggestion && <span className="muted"> → {issue.suggestion}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {steps.length === 0 ? (
        <p className="muted pipeline-empty">还没有记录流水线步骤。</p>
      ) : (
        <ol className="pipeline-timeline">
          {steps.map((step) => (
            <li key={step.id} className={`pipeline-step pipeline-step-${step.status.toLowerCase()}`}>
              <div className="pipeline-step-dot" aria-hidden />
              <div className="pipeline-step-body">
                <div className="pipeline-step-header">
                  <strong>{labelForPipelineStep(step.stepKey)}</strong>
                  <span className={`tag tag-job tag-job-${step.status.toLowerCase()}`}>
                    {labelForGenerationJobStatus(step.status)}
                  </span>
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
                {step.promptSnapshot && (
                  <details className="pipeline-step-preview pipeline-step-prompt">
                    <summary>查看提示词快照</summary>
                    <pre>{step.promptSnapshot}</pre>
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
