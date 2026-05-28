"use client";

import { useCallback, useEffect, useState } from "react";
import type { QueueJobSummary, QueueObservability } from "../../server/queue-observability";
import {
  formatQueueWait,
  getHealthToneClass,
  getStatusItems,
  isQueueEmpty
} from "./queue-observability-panel-model";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Props {
  enabled: boolean;
}

export function QueueObservabilityPanel({ enabled }: Props) {
  const [data, setData] = useState<QueueObservability | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/queue-observability");
      const json = (await res.json()) as ApiEnvelope<QueueObservability>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `加载队列健康失败 (${res.status})`);
      }
      setData(json.data);
    } catch (err: unknown) {
      setData(null);
      setError(err instanceof Error ? err.message : "加载队列健康失败");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!enabled) {
        if (active) setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/queue-observability");
        const json = (await res.json()) as ApiEnvelope<QueueObservability>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error ?? `加载队列健康失败 (${res.status})`);
        }
        if (active) setData(json.data);
      } catch (err: unknown) {
        if (active) {
          setData(null);
          setError(err instanceof Error ? err.message : "加载队列健康失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [enabled]);

  return (
    <section className="queue-observability-panel" aria-label="队列健康">
      <div className="queue-observability-header">
        <div>
          <h2>队列健康</h2>
          <p className="muted">生成任务状态、排队等待与最近任务</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={!enabled || isLoading}>
          {isLoading ? "刷新中" : "刷新"}
        </button>
      </div>

      {!enabled && <p className="performance-empty muted">配置默认组织后可查看队列健康。</p>}

      {enabled && isLoading && !data && (
        <div className="performance-skeleton queue-observability-skeleton" aria-label="队列健康加载中">
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

      {data && !error && (
        <div className="queue-observability-layout">
          <HealthSummary data={data} />
          <StatusBreakdown data={data} />
          <RecentJobs jobs={data.recentJobs} />
        </div>
      )}

      {isQueueEmpty(data) && !isLoading && !error && (
        <p className="performance-empty muted">当前组织还没有生成任务记录。</p>
      )}
    </section>
  );
}

function HealthSummary({ data }: { data: QueueObservability }) {
  const wait = formatQueueWait(data.oldestQueued?.waitMs ?? null);

  return (
    <div className={`queue-health-summary ${getHealthToneClass(data.health.state)}`}>
      <div>
        <span className="queue-health-label">{data.health.label}</span>
        <strong>{data.health.detail}</strong>
      </div>
      <div className="queue-health-metrics">
        <Metric label="总任务" value={String(data.totals.total)} />
        <Metric label="排队" value={String(data.totals.queued)} />
        <Metric label="运行" value={String(data.totals.running)} />
        <Metric label="最老等待" value={wait} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="queue-health-metric">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBreakdown({ data }: { data: QueueObservability }) {
  return (
    <section className="performance-section queue-status-section" aria-label="队列状态分布">
      <div className="performance-section-heading">
        <h4>状态分布</h4>
        <span className="muted">{new Date(data.generatedAt).toLocaleTimeString()}</span>
      </div>
      <ul className="queue-status-list">
        {getStatusItems(data).map((item) => (
          <li key={item.key} className={`queue-status-row queue-status-${item.tone}`}>
            <span>{item.label}</span>
            <div className="performance-bar-track" aria-hidden>
              <span className="queue-status-fill" style={{ width: item.width }} />
            </div>
            <strong>{item.value}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentJobs({ jobs }: { jobs: QueueJobSummary[] }) {
  return (
    <section className="performance-section queue-recent-section" aria-label="最近队列任务">
      <div className="performance-section-heading">
        <h4>最近任务</h4>
        <span className="muted">{jobs.length} 条</span>
      </div>
      {jobs.length === 0 ? (
        <p className="performance-empty muted">暂无任务记录</p>
      ) : (
        <ol className="queue-recent-list">
          {jobs.map((job) => (
            <li key={job.id} className="queue-recent-row">
              <div>
                <strong>{labelJobType(job.jobType)}</strong>
                <span className="muted">{job.projectTitle}</span>
              </div>
              <span className={`tag tag-job tag-job-${job.status.toLowerCase()}`}>{job.status}</span>
              <span className="muted queue-recent-time">{formatJobTime(job)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function labelJobType(jobType: string): string {
  const labels: Record<string, string> = {
    GENERATE_CHAPTER: "生成章节",
    DIAGNOSE_CHAPTER: "章节诊断",
    DESLOP: "去 AI 味",
    EXTRACT_MEMORY: "抽取记忆"
  };
  return labels[jobType] ?? jobType;
}

function formatJobTime(job: QueueJobSummary): string {
  const value = job.finishedAt ?? job.startedAt ?? job.createdAt;
  return new Date(value).toLocaleTimeString();
}
