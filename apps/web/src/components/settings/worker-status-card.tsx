"use client";

import { useCallback, useEffect, useState } from "react";

interface WorkerInfo {
  lockKey: string;
  pid: number | null;
  startedAt: string;
  lastSeenAt: string;
  pollIntervalMs: number;
  leaseDurationMs: number;
  lastTickStatus: string | null;
  lastTickAt: string | null;
  online: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const TICK_STATUS_LABELS: Record<string, string> = {
  starting: "启动中",
  processed: "已处理任务",
  no_job: "空闲",
  no_handler: "无处理器",
  retried: "已重排重试",
  error: "轮询出错"
};

function formatRelative(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  return `${Math.round(diff / 3_600_000)} 小时前`;
}

// worker 健康状态：任务长时间排队时，用它区分"worker 没启动"和"任务只是慢"。
export function WorkerStatusCard() {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [anyOnline, setAnyOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/worker/health");
      const json = (await res.json()) as ApiEnvelope<{ anyOnline: boolean; workers: WorkerInfo[] }>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `请求失败 (${res.status})`);
      }
      setWorkers(json.data.workers);
      setAnyOnline(json.data.anyOnline);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "无法读取 worker 状态");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <section className="settings-card worker-status-card">
      <div className="settings-card-header">
        <h2>生成 worker</h2>
        <span className={`tag ${anyOnline ? "tag-active" : "tag-job-failed"}`}>
          {loading ? "检测中" : anyOnline ? "在线" : "离线"}
        </span>
      </div>

      {error && <p className="form-error">{error}</p>}

      {!loading && !error && workers.length === 0 && (
        <p className="form-hint warn">
          没有检测到任何 worker。任务会一直停留在「排队中」，请在项目目录运行 <code>pnpm dev:worker</code> 启动。
        </p>
      )}

      {workers.length > 0 && (
        <ul className="settings-list">
          {workers.map((worker) => (
            <li key={worker.lockKey} className="settings-list-item">
              <div className="settings-list-main">
                <div className="settings-list-title">
                  <span className={`tag ${worker.online ? "tag-active" : "tag-job-failed"}`}>
                    {worker.online ? "在线" : "心跳超时"}
                  </span>
                  <code>{worker.lockKey}</code>
                </div>
                <div className="settings-list-meta">
                  <span>pid {worker.pid ?? "-"}</span>
                  <span>轮询 {worker.pollIntervalMs}ms</span>
                  <span>租约 {worker.leaseDurationMs}ms</span>
                  <span>最后心跳 {formatRelative(worker.lastSeenAt)}</span>
                  {worker.lastTickStatus && (
                    <span>最近状态 {TICK_STATUS_LABELS[worker.lastTickStatus] ?? worker.lastTickStatus}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!anyOnline && workers.length > 0 && (
        <p className="form-hint warn">
          检测到 worker 记录但心跳已超时。请确认 worker 进程是否仍在运行。
        </p>
      )}
    </section>
  );
}
