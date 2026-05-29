import type { JobSummary } from "./use-workspace-data";
import {
  labelForGenerationJobStatus,
  labelForPipelineStep
} from "../../lib/display-labels";

interface Props {
  job: JobSummary;
}

export function PipelineTimeline({ job }: Props) {
  const steps = job.steps ?? [];
  if (steps.length === 0) {
    return (
      <p className="muted pipeline-empty">还没有记录流水线步骤。</p>
    );
  }

  return (
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
  );
}
