"use client";

import { useState } from "react";
import {
  usePerformanceTrends,
  type PerformanceTrends,
  type PerformanceTrendWindow
} from "./use-workspace-data";
import {
  formatLatency,
  formatTokens,
  formatTrendWindowLabel
} from "./performance-trends-format";

interface PerformancePanelProps {
  projectId: string | null;
}

const WINDOWS: PerformanceTrendWindow[] = ["7d", "30d"];

export function PerformancePanel({ projectId }: PerformancePanelProps) {
  const [window, setWindow] = useState<PerformanceTrendWindow>("30d");
  const { trends, isLoading, error, reload } = usePerformanceTrends(projectId, window);
  const isEmpty = !isLoading && !error && trends !== null && trends.totals.calls === 0;

  return (
    <section className="performance-panel" aria-label="性能趋势">
      <div className="performance-panel-header">
        <div>
          <h3>性能趋势</h3>
          <p className="muted">当前项目的模型调用、tokens 与延迟</p>
        </div>
        <div className="performance-window-control" role="radiogroup" aria-label="时间范围">
          {WINDOWS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={window === value}
              className={`performance-window-option ${window === value ? "active" : ""}`}
              onClick={() => setWindow(value)}
            >
              {formatTrendWindowLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {!projectId && <p className="performance-empty muted">请选择项目后查看性能趋势。</p>}

      {projectId && isLoading && (
        <div className="performance-skeleton" aria-label="性能趋势加载中">
          <div />
          <div />
          <div />
          <div />
        </div>
      )}

      {projectId && error && (
        <div className="performance-error">
          <p className="form-error">{error}</p>
          <button type="button" className="btn-ghost" onClick={() => void reload()}>
            重试
          </button>
        </div>
      )}

      {isEmpty && <p className="performance-empty muted">暂无性能数据。真实模型调用完成后会在这里形成趋势。</p>}

      {trends && !isLoading && !error && (
        <>
          <MetricGrid trends={trends} />
          <DailyTrend trends={trends} />
          <BreakdownSection trends={trends} />
        </>
      )}
    </section>
  );
}

function MetricGrid({ trends }: { trends: PerformanceTrends }) {
  return (
    <div className="performance-metric-grid" aria-label="性能关键指标">
      <Metric label="调用" value={String(trends.totals.calls)} />
      <Metric label="Tokens" value={formatTokens(trends.totals.totalTokens)} />
      <Metric label="平均延迟" value={formatLatency(trends.totals.averageLatencyMs)} />
      <Metric label="P95 延迟" value={formatLatency(trends.totals.p95LatencyMs)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="performance-metric">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DailyTrend({ trends }: { trends: PerformanceTrends }) {
  const maxCalls = Math.max(...trends.daily.map((day) => day.calls), 1);

  return (
    <section className="performance-section" aria-label="每日趋势">
      <div className="performance-section-heading">
        <h4>每日趋势</h4>
        <span className="muted">{formatTrendWindowLabel(trends.window)}</span>
      </div>
      <ol className="performance-trend-list">
        {trends.daily.map((day) => {
          const width = `${Math.max(4, Math.round((day.calls / maxCalls) * 100))}%`;
          return (
            <li key={day.date} className="performance-trend-row">
              <span className="performance-trend-date">{day.date.slice(5)}</span>
              <div className="performance-bar-track" aria-hidden>
                <span className="performance-bar-fill" style={{ width }} />
              </div>
              <span className="performance-trend-value">{day.calls} 次</span>
              <span className="performance-trend-tokens">{formatTokens(day.inputTokens + day.outputTokens)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function BreakdownSection({ trends }: { trends: PerformanceTrends }) {
  return (
    <div className="performance-breakdowns">
      <BreakdownList
        title="模型"
        items={trends.byModel.slice(0, 4).map((item) => ({
          key: item.modelName,
          label: item.modelName,
          meta: `${item.calls} 次 / ${formatTokens(item.totalTokens)}`
        }))}
      />
      <BreakdownList
        title="Provider"
        items={trends.byProvider.slice(0, 4).map((item) => ({
          key: item.providerId ?? "unknown",
          label: item.providerName ?? "未记录",
          meta: `${item.calls} 次 / ${formatTokens(item.totalTokens)}`
        }))}
      />
      <BreakdownList
        title="任务"
        items={trends.byJobType.slice(0, 5).map((item) => ({
          key: item.jobType,
          label: labelJobType(item.jobType),
          meta: `${item.calls} 次 / ${formatTokens(item.totalTokens)}`
        }))}
      />
    </div>
  );
}

function BreakdownList({ title, items }: { title: string; items: Array<{ key: string; label: string; meta: string }> }) {
  return (
    <section className="performance-section" aria-label={`${title}分布`}>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="performance-empty muted">暂无数据</p>
      ) : (
        <ul className="performance-breakdown-list">
          {items.map((item) => (
            <li key={item.key}>
              <span>{item.label}</span>
              <span className="muted">{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function labelJobType(jobType: string): string {
  const labels: Record<string, string> = {
    GENERATE_CHAPTER: "生成章节",
    DIAGNOSE_CHAPTER: "章节诊断",
    DESLOP: "去 AI 味",
    EXTRACT_MEMORY: "抽取记忆",
    UNKNOWN: "未记录"
  };
  return labels[jobType] ?? jobType;
}
