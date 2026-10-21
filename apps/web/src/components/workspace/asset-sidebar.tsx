"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { labelForChapterStatus } from "../../lib/display-labels";

interface ChapterItem {
  id: string;
  chapterNo: number;
  title: string;
  status: string;
  wordCount: number;
}

interface SearchHit {
  chapterId: string;
  chapterNo: number;
  title: string;
  snippet: { before: string; match: string; after: string };
  matchCount: number;
}

interface ProjectStats {
  chapterCount: number;
  totalWords: number;
  averageWords: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface AssetSidebarProps {
  chapters: ChapterItem[];
  activeChapterId: string | null;
  onSelect: (id: string) => void;
  onCreate?: (input: { chapterNo: number; title: string }) => Promise<unknown>;
  isLoading?: boolean;
  exportHref?: string | null;
  projectId?: string | null;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export function AssetSidebar({
  chapters,
  activeChapterId,
  onSelect,
  onCreate,
  isLoading = false,
  exportHref = null,
  projectId = null,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore
}: AssetSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextChapterNo = chapters.length === 0
    ? 1
    : Math.max(...chapters.map((c) => c.chapterNo)) + 1;

  const runSearch = useCallback(
    async (raw: string) => {
      const keyword = raw.trim();
      if (!projectId || keyword.length === 0) {
        setHits(null);
        setSearching(false);
        setSearchError(null);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/search?q=${encodeURIComponent(keyword)}`
        );
        const json = (await res.json()) as ApiEnvelope<{ hits: SearchHit[] }>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error ?? `搜索失败 (${res.status})`);
        }
        setHits(json.data.hits);
        setSearchError(null);
      } catch (e: unknown) {
        setHits([]);
        setSearchError(e instanceof Error ? e.message : "搜索失败");
      } finally {
        setSearching(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/stats`);
        const json = (await res.json()) as ApiEnvelope<ProjectStats>;
        if (!cancelled && res.ok && json.success && json.data) setStats(json.data);
      } catch {
        // 统计信息是辅助展示，失败时静默降级
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, chapters.length]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(value), 300);
  }

  function clearSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuery("");
    setHits(null);
    setSearchError(null);
  }

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

  const showingSearch = hits !== null;

  return (
    <aside className="pane pane-muted stack" aria-label="章节目录">
      <div className="sidebar-header">
        <h2>章节目录</h2>
        <div className="sidebar-header-actions">
          {exportHref && chapters.length > 0 && (
            <a className="btn-ghost btn-small" href={exportHref} download>
              导出
            </a>
          )}
          {onCreate && !creating && (
            <button type="button" className="btn-ghost btn-small" onClick={() => setCreating(true)}>
              + 新建
            </button>
          )}
        </div>
      </div>

      {stats && (
        <p className="sidebar-stats muted">
          共 {stats.chapterCount} 章 · {stats.totalWords.toLocaleString()} 字 · 均{" "}
          {stats.averageWords.toLocaleString()} 字/章
        </p>
      )}

      {projectId && (
        <div className="sidebar-search">
          <input
            type="search"
            className="sidebar-search-input"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="搜索全书内容"
            aria-label="搜索全书内容"
          />
          {query && (
            <button type="button" className="btn-ghost btn-small" onClick={clearSearch} aria-label="清空搜索">
              清空
            </button>
          )}
        </div>
      )}

      {creating && (
        <form className="chapter-create-form" onSubmit={handleCreate}>
          <span className="muted">第 {nextChapterNo} 章</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="章节标题"
            required
          />
          <div className="chapter-create-actions">
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !title.trim()}>
              {submitting ? "创建中" : "创建"}
            </button>
          </div>
        </form>
      )}

      {showingSearch ? (
        <div className="search-results">
          {searching && <p className="muted">搜索中...</p>}
          {searchError && <p className="form-error">{searchError}</p>}
          {!searching && !searchError && hits.length === 0 && (
            <p className="muted">没有找到匹配的章节</p>
          )}
          {hits.length > 0 && (
            <>
              <p className="muted search-summary">命中 {hits.length} 章</p>
              <ul className="search-hit-list">
                {hits.map((hit) => (
                  <li key={hit.chapterId}>
                    <button
                      type="button"
                      className="search-hit"
                      onClick={() => {
                        onSelect(hit.chapterId);
                        clearSearch();
                      }}
                    >
                      <span className="search-hit-title">
                        第{hit.chapterNo}章 {hit.title}
                        <span className="search-hit-count">{hit.matchCount} 处</span>
                      </span>
                      <span className="search-hit-snippet">
                        {hit.snippet.before}
                        <mark>{hit.snippet.match}</mark>
                        {hit.snippet.after}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : isLoading ? (
        <p className="muted">加载中...</p>
      ) : chapters.length === 0 ? (
        <p className="muted">暂无章节</p>
      ) : (
        <>
          <ul className="chapter-list">
            {chapters.map((ch) => (
              <li key={ch.id}>
                <button
                  className={`chapter-item ${ch.id === activeChapterId ? "active" : ""}`}
                  onClick={() => onSelect(ch.id)}
                >
                  <span className="chapter-no">第{ch.chapterNo}章</span>
                  <span className="chapter-title">{ch.title}</span>
                  <span className="chapter-status">{labelForChapterStatus(ch.status)}</span>
                </button>
              </li>
            ))}
          </ul>
          {hasMore && onLoadMore && (
            <button
              type="button"
              className="btn-ghost btn-small chapter-load-more"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "加载中..." : "加载更多章节"}
            </button>
          )}
        </>
      )}
    </aside>
  );
}
