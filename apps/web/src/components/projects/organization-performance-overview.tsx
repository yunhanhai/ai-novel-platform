"use client";

import { useCallback, useEffect, useState } from "react";
import type { PerformanceTrends, PerformanceTrendWindow } from "../workspace/use-workspace-data";
import {
  formatLatency,
  formatTokens,
  formatTrendWindowLabel
} from "../workspace/performance-trends-format";
import {
  getMaxDailyCalls,
  isOrganizationPerformanceEmpty,
  toBreakdownItems
} from "./organization-performance-overview-model";

interface Props {
  enabled: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const WINDOWS: PerformanceTrendWindow[] = ["7d", "30d"];

export function OrganizationPerformanceOverview({ enabled }: Props) {
  const [window, setWindow] = useState<PerformanceTrendWindow>("30d");
  const [trends, setTrends] = useState<PerformanceTrends | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEmpty = isOrganizationPerformanceEmpty(trends);

  const fetchTrends = useCallback(async () => {
    const res = await fetch(`/api/performance-trends?window=${window}`);
    const json = (await res.json()) as ApiEnvelope<PerformanceTrends>;
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error ?? `加载全部项目性能失败 (${res.status})`);
    }
    return json.data;
  }, [window]);

  const load = useCallback(async () => {
    if (!enabled) {
      setTrends(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTrends(await fetchTrends());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载全部项目性能失败");
      setTrends(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchTrends]);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!enabled) {
        if (active) setTrends(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTrends();
        if (active) setTrends(data);
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : "加载全部项目性能失败");
          setTrends(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [enabled, fetchTrends]);

  return (
    <section className="organization-performance-overview" aria-label="全部项目性能">
      <div className="organization-performance-header">
        <div>
          <h2>全部项目性能</h2>
          <p className="muted">组织内所有项目的模型调用、tokens 与延迟趋势</p>
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
              disabled={!enabled}
            >
              {formatTrendWindowLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {!enabled && <p className="performance-empty muted">配置默认组织后可查看全部项目性能。</p>}

      {enabled && isLoading && (
        <div className="performance-skeleton organization-performance-skeleton" aria-label="全部项目性能加载中">
          <div />
          <div />
          <div />
          <div />
        </div>
      )}

      {enabled && error && (
        <div className="performance-error">
          <p className="form-error">{error}</p>
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {enabled && isEmpty && (
        <p className="performance-empty muted">暂无全部项目性能数据。真实模型调用完成后会在这里形成趋势。</p>
      )}

      {trends && !isLoading && !error && (
        <div className="organization-performance-layout">
          <MetricGrid trends={trends} />
          <DailyTrend trends={trends} />
          <Breakdowns trends={trends} />
        </div>
      )}
    </section>
  );
}

function MetricGrid({ trends }: { trends: PerformanceTrends }) {
  return (
    <div className="performance-metric-grid organization-performance-metrics" aria-label="全部项目性能关键指标">
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
  const maxCalls = getMaxDailyCalls(trends.daily);

  return (
    <section className="performance-section" aria-label="全部项目每日趋势">
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

function Breakdowns({ trends }: { trends: PerformanceTrends }) {
  const projectItems = toBreakdownItems(trends.byProject, 5, (item) => ({
    key: item.projectId ?? "unknown-project",
    label: item.projectTitle,
    meta: `${item.calls} 次 / ${formatTokens(item.totalTokens)} / P95 ${formatLatency(item.p95LatencyMs)}`
  }));
  const modelItems = toBreakdownItems(trends.byModel, 4, (item) => ({
    key: item.modelName,
    label: item.modelName,
    meta: `${item.calls} 次 / ${formatTokens(item.totalTokens)}`
  }));
  const providerItems = toBreakdownItems(trends.byProvider, 4, (item) => ({
    key: item.providerId ?? "unknown",
    label: item.providerName ?? "未记录",
    meta: `${item.calls} 次 / ${formatTokens(item.totalTokens)}`
  }));
  const jobItems = toBreakdownItems(trends.byJobType, 5, (item) => ({
    key: item.jobType,
    label: labelJobType(item.jobType),
    meta: `${item.calls} 次 / ${formatTokens(item.totalTokens)}`
  }));

  return (
    <div className="organization-performance-breakdowns">
      <BreakdownList title="项目排行" items={projectItems} />
      <BreakdownList title="模型" items={modelItems} />
      <BreakdownList title="Provider" items={providerItems} />
      <BreakdownList title="任务" items={jobItems} />
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
