"use client";

import { useCallback, useEffect, useState } from "react";
import type { QueueJobSummary, QueueObservability } from "../../server/queue-observability";
import {
  canRetryJob,
  formatJobAttempt,
  formatHeartbeatAge,
  formatQueueWait,
  formatRetryWait,
  getQueueActionCopy,
  getJobStatusDisplay,
  getHealthToneClass,
  getStatusItems,
  getWorkerStatusDisplay,
  isQueueEmpty
} from "./queue-observability-panel-model";
import { RecoveryAuditList } from "./recovery-audit-list";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Props {
  enabled: boolean;
}

type QueueOperationKey = "recover-expired-leases" | `retry:${string}`;

export function QueueObservabilityPanel({ enabled }: Props) {
  const [data, setData] = useState<QueueObservability | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationKey, setOperationKey] = useState<QueueOperationKey | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

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

  const recoverCopy = getQueueActionCopy("recover-expired-leases");
  const retryCopy = getQueueActionCopy("retry-failed-job");

  const recoverExpiredLeases = useCallback(async () => {
    if (!enabled) return;
    setOperationKey("recover-expired-leases");
    setOperationError(null);
    try {
      const res = await fetch("/api/queue-observability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover-expired-leases" })
      });
      const json = (await res.json()) as ApiEnvelope<{ recovered: number; failed: number }>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `回收过期租约失败 (${res.status})`);
      }
      await load();
    } catch (err: unknown) {
      setOperationError(err instanceof Error ? err.message : "回收过期租约失败");
    } finally {
      setOperationKey(null);
    }
  }, [enabled, load]);

  const retryFailedJob = useCallback(async (jobId: string) => {
    if (!enabled) return;
    setOperationKey(`retry:${jobId}`);
    setOperationError(null);
    try {
      const res = await fetch(`/api/generation-jobs/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" })
      });
      const json = (await res.json()) as ApiEnvelope<QueueJobSummary>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `重试任务失败 (${res.status})`);
      }
      await load();
    } catch (err: unknown) {
      setOperationError(err instanceof Error ? err.message : "重试任务失败");
    } finally {
      setOperationKey(null);
    }
  }, [enabled, load]);

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
        <div className="queue-observability-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void recoverExpiredLeases()}
            disabled={!enabled || isLoading || operationKey !== null}
          >
            {operationKey === "recover-expired-leases" ? recoverCopy.busyLabel : recoverCopy.label}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void load()} disabled={!enabled || isLoading}>
            {isLoading ? "刷新中" : "刷新"}
          </button>
        </div>
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

      {enabled && operationError && (
        <div className="performance-error queue-operation-error">
          <p className="form-error">{operationError}</p>
        </div>
      )}

      {data && !error && (
        <div className="queue-observability-layout">
          <HealthSummary data={data} />
          <StatusBreakdown data={data} />
          <WorkerHeartbeatSection data={data} />
          <RecoveryAuditList enabled={enabled} />
          <RecentJobs
            jobs={data.recentJobs}
            operationKey={operationKey}
            retryCopy={retryCopy}
            onRetry={retryFailedJob}
          />
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
  const retryWait = formatRetryWait(data.oldestRetrying?.retryInMs ?? null);

  return (
    <div className={`queue-health-summary ${getHealthToneClass(data.health.state)}`}>
      <div>
        <span className="queue-health-label">{data.health.label}</span>
        <strong>{data.health.detail}</strong>
      </div>
      <div className="queue-health-metrics">
        <Metric label="总任务" value={String(data.totals.total)} />
        <Metric label="排队" value={String(data.totals.queued)} />
        <Metric label="等待重试" value={String(data.totals.retrying)} />
        <Metric label="运行" value={String(data.totals.running)} />
        <Metric label="最老等待" value={wait} />
        <Metric label="最近重试" value={retryWait} />
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

function WorkerHeartbeatSection({ data }: { data: QueueObservability }) {
  return (
    <section className="performance-section queue-worker-section" aria-label="Worker 心跳">
      <div className="performance-section-heading">
        <h4>Worker 心跳</h4>
        <span className="muted">{formatHeartbeatAge(data.workers.latestHeartbeatMs)}</span>
      </div>
      <div className="queue-worker-summary" aria-label="Worker 在线概览">
        <Metric label="在线" value={`${data.workers.online}/${data.workers.total}`} />
        <Metric label="过期" value={String(data.workers.stale)} />
      </div>
      {data.workers.items.length === 0 ? (
        <p className="performance-empty muted">暂无 Worker 心跳</p>
      ) : (
        <ol className="queue-worker-list">
          {data.workers.items.slice(0, 4).map((worker) => {
            const status = getWorkerStatusDisplay(worker.status);
            return (
              <li key={worker.id} className="queue-worker-row">
                <div>
                  <strong>{worker.lockKey}</strong>
                  <span className="muted">
                    PID {worker.pid ?? "-"} · {worker.pollIntervalMs}ms
                  </span>
                </div>
                <span className={`queue-worker-status queue-worker-${status.tone}`}>{status.label}</span>
                <span className="muted queue-worker-age">{formatHeartbeatAge(worker.heartbeatAgeMs)}</span>
                <span className="muted queue-worker-tick">{labelTickStatus(worker.lastTickStatus)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RecentJobs({
  jobs,
  operationKey,
  retryCopy,
  onRetry
}: {
  jobs: QueueJobSummary[];
  operationKey: QueueOperationKey | null;
  retryCopy: { label: string; busyLabel: string };
  onRetry: (jobId: string) => void;
}) {
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
            <RecentJobRow
              key={job.id}
              job={job}
              isRetrying={operationKey === `retry:${job.id}`}
              retryCopy={retryCopy}
              onRetry={onRetry}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function RecentJobRow({
  job,
  isRetrying,
  retryCopy,
  onRetry
}: {
  job: QueueJobSummary;
  isRetrying: boolean;
  retryCopy: { label: string; busyLabel: string };
  onRetry: (jobId: string) => void;
}) {
  const status = getJobStatusDisplay(job);
  const canRetry = canRetryJob(job);

  return (
    <li className="queue-recent-row">
      <div>
        <strong>{labelJobType(job.jobType)}</strong>
        <span className="muted">{job.projectTitle}</span>
      </div>
      <span className={`tag tag-job tag-job-${status.tone}`}>{status.label}</span>
      <span className="muted queue-recent-attempt">{formatJobAttempt(job)}</span>
      <span className="muted queue-recent-time">{formatJobTime(job)}</span>
      <span className="queue-recent-action">
        {canRetry && (
          <button
            type="button"
            className="btn-ghost btn-small"
            onClick={() => onRetry(job.id)}
            disabled={isRetrying}
          >
            {isRetrying ? retryCopy.busyLabel : retryCopy.label}
          </button>
        )}
      </span>
    </li>
  );
}

function labelTickStatus(status: string | null): string {
  const labels: Record<string, string> = {
    processed: "已处理",
    no_job: "空轮询",
    no_handler: "无处理器",
    error: "错误"
  };
  return status ? labels[status] ?? status : "未轮询";
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
