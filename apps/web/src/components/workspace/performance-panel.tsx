"use client";

import { useCallback, useEffect, useState } from "react";
import { labelForGenerationJobType } from "../../lib/display-labels";
import type {
  PerformanceTrends,
  PerformanceTrendWindow
} from "../../server/performance-trends";
import {
  formatCostCents,
  formatLatency,
  formatTokens,
  formatTrendWindowLabel
} from "./performance-trends-format";

function usePerformanceTrends(projectId: string | null, window: PerformanceTrendWindow) {
  const [trends, setTrends] = useState<PerformanceTrends | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setTrends(null);
    setError(null);
    if (!projectId) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/performance-trends?window=${window}`, { signal: controller.signal });
        const json = await response.json() as { success: boolean; data?: PerformanceTrends; error?: string };
        if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? "读取性能趋势失败");
        if (!controller.signal.aborted) setTrends(json.data);
      } catch (error: unknown) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "读取性能趋势失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [projectId, window, refreshKey]);

  return { trends, isLoading, error, reload };
}
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
          <p className="muted">当前项目的模型用量记录与 tokens；生成任务按多步骤合计，耗时按记录统计。</p>
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
          <Insights trends={trends} />
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
      <Metric label="用量记录" value={String(trends.totals.calls)} />
      <Metric label="Tokens" value={formatTokens(trends.totals.totalTokens)} />
      <Metric label="已知成本" value={formatCostCents(trends.totals.estimatedCostCents)} />
      <Metric label="平均记录耗时" value={formatLatency(trends.totals.averageLatencyMs)} />
      <Metric label="P95 记录耗时" value={formatLatency(trends.totals.p95LatencyMs)} />
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

function Insights({ trends }: { trends: PerformanceTrends }) {
  const insights = trends.insights ?? [];

  return (
    <section className="performance-section performance-panel-insights" aria-label="需要关注">
      <div className="performance-section-heading">
        <h4>需要关注</h4>
        <span className="muted">{insights.length} 项</span>
      </div>
      {insights.length === 0 ? (
        <p className="performance-empty muted">当前窗口没有明显性能或成本异常。</p>
      ) : (
        <ul className="performance-insight-list">
          {insights.map((insight) => (
            <li key={`${insight.id}-${insight.targetProjectId ?? "global"}`} className={`performance-insight performance-insight-${insight.severity}`}>
              <span className="performance-insight-severity">{labelSeverity(insight.severity)}</span>
              <div>
                <strong>{insight.title}</strong>
                <p className="muted">{insight.detail}</p>
              </div>
              {insight.metricLabel && <span className="performance-insight-metric">{insight.metricLabel}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
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
  return jobType === "UNKNOWN" ? "未记录" : labelForGenerationJobType(jobType);
}

function labelSeverity(severity: "info" | "warning" | "critical"): string {
  const labels = {
    info: "提示",
    warning: "关注",
    critical: "紧急"
  };
  return labels[severity];
}
