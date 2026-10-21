"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ChapterVersionItem {
  id: string;
  versionNo: number;
  source: "MANUAL" | "AI" | "IMPORT";
  generationJobId: string | null;
  createdAt: string;
  title: string | null;
  contentPreview: string;
  contentLength: number;
}

interface DiffSegment {
  kind: "equal" | "insert" | "delete";
  text: string;
}

interface VersionDiff {
  versionId: string;
  versionNo: number;
  source: string;
  createdAt: string;
  currentChars: number;
  targetChars: number;
  summary: { addedChars: number; removedChars: number; changed: boolean };
  segments: DiffSegment[];
}

interface Props {
  chapterId: string | null;
  onRestored?: () => void;
}

export function VersionsPanel({ chapterId, onRestored }: Props) {
  const [versions, setVersions] = useState<ChapterVersionItem[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [diffLoadingId, setDiffLoadingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!chapterId) {
      setVersions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/versions`);
      const json = (await res.json()) as ApiEnvelope<ChapterVersionItem[]>;
      if (!res.ok || !json.success) throw new Error(json.error ?? `加载失败 (${res.status})`);
      setVersions(json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleRestore(versionId: string) {
    setRestoringId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/content-versions/${versionId}`, { method: "POST" });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !json.success) throw new Error(json.error ?? `回滚失败 (${res.status})`);
      setConfirmId(null);
      setDiff(null);
      await reload();
      onRestored?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "回滚失败");
    } finally {
      setRestoringId(null);
    }
  }

  async function handleToggleDiff(versionId: string) {
    if (diff?.versionId === versionId) {
      setDiff(null);
      return;
    }
    setDiffLoadingId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/versions/diff?versionId=${versionId}`);
      const json = (await res.json()) as ApiEnvelope<VersionDiff>;
      if (!res.ok || !json.success || !json.data) throw new Error(json.error ?? `对比失败 (${res.status})`);
      setDiff(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "对比失败");
      setDiff(null);
    } finally {
      setDiffLoadingId(null);
    }
  }

  if (!chapterId) {
    return <p className="muted">请先选择一个章节</p>;
  }

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>章节版本 ({versions.length})</h3>
        <div className="memories-filter-buttons">
          <button type="button" className="btn-ghost" onClick={() => void reload()}>
            刷新
          </button>
        </div>
      </div>

      {isLoading && <p className="muted">加载中...</p>}
      {error && <p className="form-error">{error}</p>}
      {!isLoading && !error && versions.length === 0 && (
        <p className="muted">尚无版本记录</p>
      )}

      <ul className="resource-cards">
        {versions.map((v) => (
          <li key={v.id} className={`resource-card version-card version-source-${v.source.toLowerCase()}`}>
            <div className="resource-card-header">
              <strong>v{v.versionNo}</strong>
              <span className={`tag tag-version-${v.source.toLowerCase()}`}>
                {labelOfSource(v.source)}
              </span>
            </div>
            <p className="muted resource-card-meta">
              {formatTime(v.createdAt)} · {v.contentLength.toLocaleString()} 字符
              {v.generationJobId && ` · 任务 ${v.generationJobId.slice(0, 8)}`}
            </p>
            <p className="resource-card-brief version-preview">
              {v.contentPreview || <em className="muted">空版本</em>}
              {v.contentLength > 200 && <span className="muted">...</span>}
            </p>

            {confirmId === v.id ? (
              <div className="version-confirm">
                <p className="form-error">
                  确认回滚到 v{v.versionNo}？当前正文会被自动快照为新版本，不会丢失。
                </p>
                <div className="resource-card-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setConfirmId(null)}
                    disabled={restoringId === v.id}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleRestore(v.id)}
                    disabled={restoringId === v.id}
                  >
                    {restoringId === v.id ? "回滚中..." : "确认回滚"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="resource-card-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void handleToggleDiff(v.id)}
                  disabled={diffLoadingId === v.id}
                >
                  {diffLoadingId === v.id ? "对比中..." : diff?.versionId === v.id ? "收起对比" : "对比当前"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setConfirmId(v.id)}
                >
                  回滚到此版本
                </button>
              </div>
            )}

            {diff?.versionId === v.id && (
              <div className="version-diff">
                <p className="muted version-diff-summary">
                  {diff.summary.changed
                    ? `相比当前：新增 ${diff.summary.addedChars} 字 · 删除 ${diff.summary.removedChars} 字`
                    : "与当前正文一致"}
                </p>
                <div className="version-diff-body">
                  {diff.segments.map((segment, index) =>
                    segment.kind === "equal" ? (
                      <span key={index}>{segment.text}</span>
                    ) : segment.kind === "insert" ? (
                      <ins key={index}>{segment.text}</ins>
                    ) : (
                      <del key={index}>{segment.text}</del>
                    )
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="memories-help">
        <p className="muted">
          回滚操作不会丢失当前正文 — 它会先将正文保存为新版本，再把目标版本写入正文。
        </p>
      </div>
    </div>
  );
}

function labelOfSource(s: string): string {
  switch (s) {
    case "MANUAL": return "手动";
    case "AI": return "AI";
    case "IMPORT": return "导入";
    default: return s;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
