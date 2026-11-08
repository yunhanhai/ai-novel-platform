import type { JobSummary } from "./use-workspace-data";
import { DiagnosticReport } from "./diagnostic-report";
import {
  labelForGenerationJobStatus,
  labelForPipelineStep,
  labelForQualityMode,
  labelForSkipReason
} from "../../lib/display-labels";

interface Props {
  job: JobSummary;
  chapterId: string | null;
  currentContent: string;
}

export function PipelineTimeline({ job, chapterId, currentContent }: Props) {
  const steps = job.steps ?? [];
  const perf = job.output?.performanceSummary;
  const deslop = job.output?.deslopReport;

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
          {perf.contextBudget && (
            <p className="muted">
              上下文约 {perf.contextBudget.estimatedTokens} tokens / 上限 {perf.contextBudget.appliedTokenBudget}，
              纳入 {perf.contextBudget.includedCount} 项，裁剪 {perf.contextBudget.trimmedCount} 项
            </p>
          )}
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

      {job.output?.qualitySummary && (
        <div className="pipeline-warning" role="status">
          <strong>{job.output.qualitySummary.passed ? "正文约束检查通过" : "正文已保存，部分要求未达到"}</strong>
          <p className="muted">字数 {job.output.qualitySummary.charCount}；目标 {job.output.qualitySummary.minChars ?? 1}–{job.output.qualitySummary.maxChars ?? 20000} 字</p>
          {job.output.qualitySummary.missingFacts.length > 0 && <p className="muted">缺少指定片段：{job.output.qualitySummary.missingFacts.join("、")}</p>}
          <p className="muted">片段命中仅供核对，情节与语义仍需审阅。</p>
        </div>
      )}
      {job.output?.generationWarnings?.map((warning, index) => (
        <div key={`${warning.stepKey}-${index}`} className="pipeline-warning" role="status">
          <strong>正文已保存 · {labelForPipelineStep(warning.stepKey)}未完成</strong>
          <p className="muted">{warning.message}</p>
        </div>
      ))}
      {job.output?.diagnosticWarning && (
        <div className="pipeline-warning" role="status">
          <span className="tag tag-warning">诊断未排队</span>
          <span className="muted">{job.output.diagnosticWarning}</span>
        </div>
      )}

      {job.status === "SUCCEEDED" && deslop && (
        <section className="diagnostic-summary" aria-label="去 AI 味分析报告">
          <strong>自然度参考分 {deslop.overallScore}/100（越高越自然）</strong>
          <p>{deslop.summary}</p>
          <p className="muted">分析来源 {deslop.sourceChars} 字符。分数仅供语言审阅，不能判断作者身份；后续改文请重新分析。</p>
          {deslop.issues.length === 0 ? <p className="muted">本次未列出具体问题，仍需人工审阅。</p> : (
            <ul className="diagnostic-suggestions">
              {deslop.issues.map((issue, index) => (
                <li key={`${issue.position.start}-${index}`}>
                  <blockquote>{issue.matched}</blockquote>
                  <p>{issue.suggestion}</p>
                  <span className="muted">原文位置 {issue.position.start}–{issue.position.end}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <DiagnosticReport job={job} chapterId={chapterId} currentContent={currentContent} />

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
                {step.status === "SKIPPED" && step.outputPreview ? (
                  <p className="pipeline-step-skip muted">
                    跳过原因：{labelForSkipReason(step.outputPreview)}
                  </p>
                ) : step.outputPreview ? (
                  <details className="pipeline-step-preview">
                    <summary>查看输出预览</summary>
                    <pre>{step.outputPreview}</pre>
                  </details>
                ) : null}
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
