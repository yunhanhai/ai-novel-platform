"use client";

import { useCallback, useEffect, useState } from "react";

interface StatsPayload {
  chapterCount: number;
  totalWords: number;
  averageWords: number;
  longestChapter: { title: string; wordCount: number } | null;
  shortestChapter: { title: string; wordCount: number } | null;
  distribution: Array<{ label: string; count: number }>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Props {
  projectId: string | null;
}

// 写作统计面板：把 project-stats 聚合结果可视化成 KPI + 分布条。
// 纯 CSS 条形图，避免为一张小图引入图表库。
export function StatsPanel({ projectId }: Props) {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/stats`);
      const json = (await res.json()) as ApiEnvelope<StatsPayload>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `请求失败 (${res.status})`);
      }
      setStats(json.data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "统计加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!projectId) return <p className="muted">请先选择一个项目</p>;

  const maxBucket = stats ? Math.max(1, ...stats.distribution.map((bucket) => bucket.count)) : 1;

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>写作统计</h3>
        <div className="memories-filter-buttons">
          <button type="button" className="btn-ghost" onClick={() => void reload()} disabled={loading}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {!stats && loading && <p className="muted">加载中...</p>}

      {stats && (
        <>
          <div className="stats-kpi-grid">
            <div className="stats-kpi">
              <span className="stats-kpi-value">{stats.chapterCount.toLocaleString()}</span>
              <span className="stats-kpi-label">章节数</span>
            </div>
            <div className="stats-kpi">
              <span className="stats-kpi-value">{stats.totalWords.toLocaleString()}</span>
              <span className="stats-kpi-label">总字数</span>
            </div>
            <div className="stats-kpi">
              <span className="stats-kpi-value">{stats.averageWords.toLocaleString()}</span>
              <span className="stats-kpi-label">平均章字数</span>
            </div>
          </div>

          <div className="stats-extremes">
            {stats.longestChapter && (
              <p className="muted">
                最长章：<strong>{stats.longestChapter.title}</strong>（
                {stats.longestChapter.wordCount.toLocaleString()} 字）
              </p>
            )}
            {stats.shortestChapter && (
              <p className="muted">
                最短章：<strong>{stats.shortestChapter.title}</strong>（
                {stats.shortestChapter.wordCount.toLocaleString()} 字）
              </p>
            )}
          </div>

          <div className="stats-distribution">
            <p className="muted stats-section-label">章节字数分布</p>
            {stats.distribution.map((bucket) => (
              <div key={bucket.label} className="stats-bar-row">
                <span className="stats-bar-label">{bucket.label}</span>
                <span className="stats-bar-track">
                  <span
                    className="stats-bar-fill"
                    style={{ width: `${Math.round((bucket.count / maxBucket) * 100)}%` }}
                  />
                </span>
                <span className="stats-bar-count">{bucket.count}</span>
              </div>
            ))}
          </div>

          {stats.chapterCount === 0 && (
            <p className="muted">还没有章节，创建第一章后这里会显示进度。</p>
          )}
        </>
      )}
    </div>
  );
}
