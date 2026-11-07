"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  currentContent: string;
  prepareRestore: () => Promise<boolean>;
  onRestored?: () => void;
}

interface Confirmation { versionId: string; content: string; baseContentHash: string }

export function VersionsPanel({ chapterId, currentContent, prepareRestore, onRestored }: Props) {
  const [versions, setVersions] = useState<ChapterVersionItem[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [diffLoadingId, setDiffLoadingId] = useState<string | null>(null);
  const alive = useRef(false);
  const listSequence = useRef(0);
  const diffSequence = useRef(0);
  const busy = useRef(false);
  const source = useRef({ chapterId, content: currentContent });
  source.current = { chapterId, content: currentContent };
  const isCurrent = (id: string | null) => alive.current && source.current.chapterId === id;

  const reload = useCallback(async () => {
    const sequence = ++listSequence.current;
    if (!chapterId) { setVersions([]); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/versions`);
      const json = (await res.json()) as ApiEnvelope<ChapterVersionItem[]>;
      if (!alive.current || source.current.chapterId !== chapterId || listSequence.current !== sequence) return;
      if (!res.ok || !json.success) throw new Error(json.error ?? `加载失败 (${res.status})`);
      setVersions(json.data ?? []);
    } catch (err: unknown) {
      if (alive.current && source.current.chapterId === chapterId && listSequence.current === sequence) setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      if (alive.current && source.current.chapterId === chapterId && listSequence.current === sequence) setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    alive.current = true;
    setVersions([]); setConfirmation(null); setDiff(null); setDiffLoadingId(null);
    void reload();
    return () => { alive.current = false; listSequence.current++; diffSequence.current++; };
  }, [reload]);

  useEffect(() => {
    if (confirmation && confirmation.content !== currentContent) {
      setConfirmation(null); setError("正文已变化，请重新选择回滚版本。");
    }
    diffSequence.current++; setDiff(null); setDiffLoadingId(null);
  }, [currentContent, confirmation]);

  async function beginRestore(versionId: string) {
    if (!chapterId || busy.current) return;
    const id = chapterId, content = source.current.content;
    busy.current = true; setPreparing(true); setError(null); setConfirmation(null);
    try {
      if (!await prepareRestore()) throw new Error("正文尚未保存或已变化，请先保存并处理冲突后再回滚。");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
      if (!isCurrent(id)) return;
      if (source.current.content !== content) throw new Error("正文已变化，请重新选择回滚版本。");
      setConfirmation({ versionId, content, baseContentHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") });
    } catch (err: unknown) {
      if (isCurrent(id)) setError(err instanceof Error ? err.message : "回滚准备失败");
    } finally {
      busy.current = false; if (isCurrent(id)) setPreparing(false);
    }
  }

  async function handleRestore(versionId: string) {
    const confirmed = confirmation, id = chapterId;
    if (!id || !confirmed || confirmed.versionId !== versionId || busy.current) return;
    busy.current = true; setRestoringId(versionId); setError(null);
    try {
      if (source.current.content !== confirmed.content || !await prepareRestore()) throw new Error("正文尚未保存或已变化，请重新确认回滚。");
      if (!isCurrent(id)) return;
      if (source.current.content !== confirmed.content) throw new Error("正文已变化，未提交回滚。请重新选择版本。");
      const res = await fetch(`/api/content-versions/${versionId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: id, baseContentHash: confirmed.baseContentHash })
      });
      const json = (await res.json()) as ApiEnvelope<{ id: string; content: string }>;
      if (!isCurrent(id)) return;
      if (!res.ok || !json.success) {
        if (res.status === 409) setConfirmation(null);
        throw new Error(json.error ?? `回滚失败 (${res.status})`);
      }
      if (!json.data || json.data.id !== id || typeof json.data.content !== "string") throw new Error("回滚结果未确认，请重试并核对正文。");
      setConfirmation(null); setDiff(null);
      onRestored?.();
      await reload();
    } catch (err: unknown) {
      if (isCurrent(id)) setError(err instanceof Error ? err.message : "回滚失败");
    } finally {
      busy.current = false; if (isCurrent(id)) setRestoringId(null);
    }
  }

  async function handleToggleDiff(versionId: string) {
    const id = chapterId, sequence = ++diffSequence.current;
    if (diff?.versionId === versionId) { setDiff(null); setDiffLoadingId(null); return; }
    setDiffLoadingId(versionId); setError(null);
    try {
      const res = await fetch(`/api/chapters/${id}/versions/diff?versionId=${versionId}`);
      if (!res.headers.get("content-type")?.includes("application/json")) throw new Error("对比服务尚未就绪，请稍后重试");
      const json = (await res.json()) as ApiEnvelope<VersionDiff>;
      if (!isCurrent(id) || diffSequence.current !== sequence) return;
      if (!res.ok || !json.success || !json.data) throw new Error(json.error ?? `对比失败 (${res.status})`);
      setDiff(json.data);
    } catch (err: unknown) {
      if (isCurrent(id) && diffSequence.current === sequence) { setError(err instanceof Error ? err.message : "对比失败"); setDiff(null); }
    } finally {
      if (isCurrent(id) && diffSequence.current === sequence) setDiffLoadingId(null);
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

            {confirmation?.versionId === v.id ? (
              <div className="version-confirm">
                <p className="form-error">
                  确认回滚到 v{v.versionNo}？将用此版本替换已确认正文；当前非空正文会保留在版本记录中。
                </p>
                <div className="resource-card-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setConfirmation(null)}
                    disabled={Boolean(restoringId) || preparing}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleRestore(v.id)}
                    disabled={Boolean(restoringId) || preparing}
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
                  onClick={() => void beginRestore(v.id)}
                  disabled={preparing || Boolean(restoringId)}
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
          回滚前先保存编辑器稿，再保留当前非空正文的版本记录；正文变化时需重新确认。
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
