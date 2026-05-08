"use client";

import { useState } from "react";

interface ChapterItem {
  id: string;
  chapterNo: number;
  title: string;
  status: string;
  wordCount: number;
}

interface AssetSidebarProps {
  chapters: ChapterItem[];
  activeChapterId: string | null;
  onSelect: (id: string) => void;
  onCreate?: (input: { chapterNo: number; title: string }) => Promise<unknown>;
  isLoading?: boolean;
}

export function AssetSidebar({
  chapters,
  activeChapterId,
  onSelect,
  onCreate,
  isLoading = false
}: AssetSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nextChapterNo = chapters.length === 0
    ? 1
    : Math.max(...chapters.map((c) => c.chapterNo)) + 1;

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!onCreate || !title.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      await onCreate({ chapterNo: nextChapterNo, title: title.trim() });
      setTitle("");
      setCreating(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="pane pane-muted stack" aria-label="章节目录">
      <div className="sidebar-header">
        <h2>章节目录</h2>
        {onCreate && !creating && (
          <button type="button" className="btn-ghost" onClick={() => setCreating(true)}>
            + 新建
          </button>
        )}
      </div>

      {creating && (
        <form className="chapter-create-form" onSubmit={handleCreate}>
          <span className="muted">第 {nextChapterNo} 章</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="章节标题"
            autoFocus
            required
            maxLength={200}
          />
          {err && <p className="form-error">{err}</p>}
          <div className="chapter-create-actions">
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)} disabled={submitting}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !title.trim()}>
              {submitting ? "创建中" : "创建"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="muted">加载中...</p>
      ) : chapters.length === 0 ? (
        <p className="muted">暂无章节</p>
      ) : (
        <ul className="chapter-list">
          {chapters.map((ch) => (
            <li key={ch.id}>
              <button
                className={`chapter-item ${ch.id === activeChapterId ? "active" : ""}`}
                onClick={() => onSelect(ch.id)}
              >
                <span className="chapter-no">第{ch.chapterNo}章</span>
                <span className="chapter-title">{ch.title}</span>
                <span className="chapter-status">{ch.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
