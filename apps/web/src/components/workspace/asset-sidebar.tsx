"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { labelForChapterStatus } from "../../lib/display-labels";

interface ChapterItem {
  id: string;
  chapterNo: number;
  title: string;
  status: string;
  wordCount: number;
  volumeId?: string | null;
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

interface VolumeItem {
  id: string;
  title: string;
  orderIndex: number;
  status: string;
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
  onChapterMoved?: () => void;
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
  onLoadMore,
  onChapterMoved
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
  const [volumes, setVolumes] = useState<VolumeItem[]>([]);
  const [creatingVolume, setCreatingVolume] = useState(false);
  const [volumeTitle, setVolumeTitle] = useState("");
  const [volumeBusy, setVolumeBusy] = useState(false);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [assigningChapterId, setAssigningChapterId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingChapterId, setDeletingChapterId] = useState<string | null>(null);
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
        const [statsRes, volumesRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/stats`),
          fetch(`/api/projects/${projectId}/volumes`)
        ]);
        const statsJson = (await statsRes.json()) as ApiEnvelope<ProjectStats>;
        if (!cancelled && statsRes.ok && statsJson.success && statsJson.data) {
          setStats(statsJson.data);
        }
        const volumesJson = (await volumesRes.json()) as ApiEnvelope<VolumeItem[]>;
        if (!cancelled && volumesRes.ok && volumesJson.success && volumesJson.data) {
          setVolumes(volumesJson.data);
        }
      } catch {
        // 统计与分卷信息是辅助展示，失败时静默降级
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

  async function handleCreateVolume(event: React.FormEvent) {
    event.preventDefault();
    const title = volumeTitle.trim();
    if (!projectId || !title) return;
    setVolumeBusy(true);
    setVolumeError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/volumes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const json = (await res.json()) as ApiEnvelope<VolumeItem>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `创建分卷失败 (${res.status})`);
      }
      setVolumes((prev) => [...prev, json.data!]);
      setVolumeTitle("");
      setCreatingVolume(false);
    } catch (e: unknown) {
      setVolumeError(e instanceof Error ? e.message : "创建分卷失败");
    } finally {
      setVolumeBusy(false);
    }
  }

  // 把章节移动到指定分卷（空字符串表示移出分卷）。
  async function handleAssignVolume(chapterId: string, volumeId: string) {
    setAssigningChapterId(chapterId);
    setVolumeError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volumeId: volumeId || null })
      });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `移动章节失败 (${res.status})`);
      }
      onChapterMoved?.();
    } catch (e: unknown) {
      setVolumeError(e instanceof Error ? e.message : "移动章节失败");
    } finally {
      setAssigningChapterId(null);
    }
  }

  // 软删除章节：后端只置 deletedAt，正文与版本链保留。
  async function handleDeleteChapter(chapterId: string) {
    setDeletingChapterId(chapterId);
    setVolumeError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}`, { method: "DELETE" });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `删除章节失败 (${res.status})`);
      }
      setConfirmDeleteId(null);
      onChapterMoved?.();
    } catch (e: unknown) {
      setVolumeError(e instanceof Error ? e.message : "删除章节失败");
    } finally {
      setDeletingChapterId(null);
    }
  }

  // 按分卷分组：未归属分卷的章节单独成组（不显示标题），
  // 分卷顺序按 orderIndex，组内章节按 chapterNo。
  const groupedChapters = (() => {
    if (volumes.length === 0) {
      return [{ volumeId: null as string | null, volumeTitle: null as string | null, chapters }];
    }
    const byVolume = new Map<string, ChapterItem[]>();
    const ungrouped: ChapterItem[] = [];
    for (const chapter of chapters) {
      if (chapter.volumeId && volumes.some((volume) => volume.id === chapter.volumeId)) {
        const list = byVolume.get(chapter.volumeId) ?? [];
        list.push(chapter);
        byVolume.set(chapter.volumeId, list);
      } else {
        ungrouped.push(chapter);
      }
    }
    const groups = volumes.map((volume) => ({
      volumeId: volume.id as string | null,
      volumeTitle: volume.title as string | null,
      chapters: (byVolume.get(volume.id) ?? []).sort((a, b) => a.chapterNo - b.chapterNo)
    }));
    if (ungrouped.length > 0) {
      groups.push({
        volumeId: null,
        volumeTitle: volumes.length > 0 ? "未分卷" : null,
        chapters: ungrouped.sort((a, b) => a.chapterNo - b.chapterNo)
      });
    }
    return groups.filter((group) => group.chapters.length > 0 || group.volumeTitle !== null);
  })();

  return (
    <aside className="pane pane-muted stack asset-sidebar" aria-label="章节目录">
      <div className="sidebar-header">
        <h2>章节目录</h2>
        <div className="sidebar-header-actions">
          {exportHref && chapters.length > 0 && (
            <a className="btn-ghost btn-small" href={exportHref} download>
              导出
            </a>
          )}
          {projectId && !creatingVolume && (
            <button
              type="button"
              className="btn-ghost btn-small"
              onClick={() => setCreatingVolume(true)}
              title="新建分卷"
            >
              + 卷
            </button>
          )}
          {onCreate && !creating && (
            <button type="button" className="btn-ghost btn-small" onClick={() => setCreating(true)}>
              + 新建
            </button>
          )}
        </div>
      </div>

      {creatingVolume && (
        <form className="chapter-create-form" onSubmit={handleCreateVolume}>
          <span className="muted">新建分卷</span>
          <input
            type="text"
            value={volumeTitle}
            onChange={(e) => setVolumeTitle(e.target.value)}
            placeholder="分卷标题（如：第一卷 风起）"
            required
            autoFocus
          />
          <div className="chapter-create-actions">
            <button type="button" className="btn-ghost" onClick={() => setCreatingVolume(false)}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={volumeBusy || !volumeTitle.trim()}>
              {volumeBusy ? "创建中" : "创建"}
            </button>
          </div>
        </form>
      )}

      {volumeError && <p className="form-error">{volumeError}</p>}

      {confirmDeleteId && (
        <div className="chapter-delete-confirm">
          <p className="form-error">
            确认删除「{chapters.find((c) => c.id === confirmDeleteId)?.title ?? "该章节"}」？正文会被标记删除，
            历史版本仍保留在版本记录中。
          </p>
          <div className="chapter-create-actions">
            <button type="button" className="btn-ghost" onClick={() => setConfirmDeleteId(null)}>
              取消
            </button>
            <button
              type="button"
              className="btn-ghost danger"
              onClick={() => void handleDeleteChapter(confirmDeleteId)}
              disabled={deletingChapterId === confirmDeleteId}
            >
              {deletingChapterId === confirmDeleteId ? "删除中..." : "确认删除"}
            </button>
          </div>
        </div>
      )}

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
          {groupedChapters.map((group) => (
            <div key={group.volumeId ?? "__none__"} className="chapter-group">
              {group.volumeTitle && (
                <p className="chapter-group-title">
                  {group.volumeTitle}
                  <span className="chapter-group-count">{group.chapters.length}</span>
                </p>
              )}
              <ul className="chapter-list">
                {group.chapters.map((ch) => (
                  <li key={ch.id} className="chapter-list-item">
                    <button
                      className={`chapter-item ${ch.id === activeChapterId ? "active" : ""}`}
                      onClick={() => onSelect(ch.id)}
                    >
                      <span className="chapter-no">第{ch.chapterNo}章</span>
                      <span className="chapter-title">{ch.title}</span>
                      <span className="chapter-status">{labelForChapterStatus(ch.status)}</span>
                    </button>
                    {volumes.length > 0 && (
                      <select
                        className="chapter-volume-select"
                        aria-label={`将「${ch.title}」移动到分卷`}
                        value={ch.volumeId ?? ""}
                        disabled={assigningChapterId === ch.id}
                        onChange={(e) => void handleAssignVolume(ch.id, e.target.value)}
                        title="移动到分卷"
                      >
                        <option value="">未分卷</option>
                        {volumes.map((volume) => (
                          <option key={volume.id} value={volume.id}>
                            {volume.title}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      className="chapter-delete"
                      aria-label={`删除章节「${ch.title}」`}
                      title="删除章节"
                      disabled={deletingChapterId === ch.id}
                      onClick={() => setConfirmDeleteId(ch.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
