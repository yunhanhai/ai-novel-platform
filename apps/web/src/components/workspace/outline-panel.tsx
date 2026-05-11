"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface OutlineItem {
  id: string;
  projectId: string;
  parentId: string | null;
  level: "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";
  title: string;
  orderIndex: number;
  summary: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  projectId: string | null;
}

const LEVEL_LABELS: Record<string, string> = {
  BOOK: "书",
  VOLUME: "卷",
  CHAPTER: "章",
  BEAT: "节拍"
};

const LEVEL_OPTIONS = ["BOOK", "VOLUME", "CHAPTER", "BEAT"] as const;

export function OutlinePanel({ projectId }: Props) {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // new/edit form state
  const [formLevel, setFormLevel] = useState<string>("CHAPTER");
  const [formTitle, setFormTitle] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formParentId, setFormParentId] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/outlines?projectId=${encodeURIComponent(projectId)}`);
      const json = (await res.json()) as ApiEnvelope<OutlineItem[]>;
      if (json.success) setItems(json.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) void reload();
  }, [projectId, reload]);

  function resetForm() {
    setFormLevel("CHAPTER");
    setFormTitle("");
    setFormSummary("");
    setFormParentId("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(item: OutlineItem) {
    setFormLevel(item.level);
    setFormTitle(item.title);
    setFormSummary(item.summary ?? "");
    setFormParentId(item.parentId ?? "");
    setEditingId(item.id);
    setShowForm(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !formTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        // PATCH
        const res = await fetch(`/api/outlines/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle.trim(),
            summary: formSummary.trim() || undefined
          })
        });
        const json = (await res.json()) as ApiEnvelope<OutlineItem>;
        if (!res.ok || !json.success) throw new Error(json.error ?? "更新失败");
      } else {
        // POST
        const res = await fetch("/api/outlines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            level: formLevel,
            title: formTitle.trim(),
            summary: formSummary.trim() || undefined,
            parentId: formParentId || undefined,
            orderIndex: items.filter((i) => i.level === formLevel).length
          })
        });
        const json = (await res.json()) as ApiEnvelope<OutlineItem>;
        if (!res.ok || !json.success) throw new Error(json.error ?? "创建失败");
      }
      resetForm();
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除此大纲条目？")) return;
    try {
      const res = await fetch(`/api/outlines/${id}`, { method: "DELETE" });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !json.success) throw new Error(json.error ?? "删除失败");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  if (!projectId) return <p className="muted">请先选择一个项目</p>;

  const itemsByLevel = groupBy(items, (i) => i.level);

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>大纲</h3>
        <div className="memories-filter-buttons">
          <button type="button" className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            新建
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">加载中...</p>}

      {showForm && (
        <form className="resource-form" onSubmit={(e) => void handleSave(e)}>
          {!editingId && (
            <label>
              <span>层级</span>
              <select value={formLevel} onChange={(e) => setFormLevel(e.target.value)}>
                {LEVEL_OPTIONS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>标题 *</span>
            <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} required maxLength={200} />
          </label>
          {!editingId && (
            <label>
              <span>父级</span>
              <select value={formParentId} onChange={(e) => setFormParentId(e.target.value)}>
                <option value="">-- 无 --</option>
                {items.filter((i) => i.level !== "BEAT").map((i) => (
                  <option key={i.id} value={i.id}>{LEVEL_LABELS[i.level]} · {i.title}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>摘要</span>
            <textarea
              value={formSummary}
              onChange={(e) => setFormSummary(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </label>
          <div className="memories-filter-buttons">
            <button type="submit" className="btn-primary" disabled={saving || !formTitle.trim()}>
              {saving ? "保存中..." : editingId ? "更新" : "创建"}
            </button>
            <button type="button" className="btn-ghost" onClick={resetForm} disabled={saving}>
              取消
            </button>
          </div>
        </form>
      )}

      {(["BOOK", "VOLUME", "CHAPTER", "BEAT"] as const).map((level) => {
        const list = itemsByLevel.get(level) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={level} className="outline-level-group">
            <h4 className="outline-level-title">{LEVEL_LABELS[level]} ({list.length})</h4>
            <ul className="resource-cards">
              {list.map((item) => (
                <li key={item.id} className="resource-card">
                  <div className="resource-card-header">
                    <strong>{item.title}</strong>
                    <span className="tag tag-method">{item.status}</span>
                  </div>
                  {item.summary && <p className="muted resource-card-meta">{item.summary.slice(0, 120)}</p>}
                  <div className="resource-card-actions">
                    <button type="button" className="btn-ghost" onClick={() => startEdit(item)}>编辑</button>
                    <button type="button" className="btn-ghost" onClick={() => void handleDelete(item.id)}>删除</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) group.push(item);
    else map.set(key, [item]);
  }
  return map;
}
