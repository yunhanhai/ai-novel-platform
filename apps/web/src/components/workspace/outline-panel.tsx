"use client";

import { useCallback, useEffect, useState } from "react";
import { AiDraftDialog, type FieldSpec } from "./ai-draft-dialog";

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
  job?: import("./use-workspace-data").JobSummary | null;
  isStarting?: boolean;
  onGenerateOutline?: (chapterCount: number) => void;
  onGenerated?: () => void;
}

const LEVEL_LABELS: Record<string, string> = {
  BOOK: "书",
  VOLUME: "卷",
  CHAPTER: "章",
  BEAT: "节拍"
};

const LEVEL_OPTIONS = ["BOOK", "VOLUME", "CHAPTER", "BEAT"] as const;

interface OutlineDraft extends Record<string, unknown> {
  level: "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";
  title: string;
  summary: string;
  orderIndex: number;
}

const DRAFT_FIELDS: ReadonlyArray<FieldSpec<OutlineDraft>> = [
  { key: "title", label: "标题", control: "input" },
  { key: "summary", label: "摘要", control: "textarea", rows: 3 }
];

export function OutlinePanel({ projectId, job = null, isStarting = false, onGenerateOutline, onGenerated }: Props) {
  const [batchCount, setBatchCount] = useState(5);
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
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLevel, setAiLevel] = useState<typeof LEVEL_OPTIONS[number]>("CHAPTER");

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

  useEffect(() => {
    if (job?.jobType === "GENERATE_OUTLINE" && job.status === "SUCCEEDED") {
      void reload();
      onGenerated?.();
    }
  }, [job?.jobType, job?.status, job?.id, reload, onGenerated]);

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
  const isOutlineJob = job?.jobType === "GENERATE_OUTLINE";
  const outlineRunning = Boolean(isOutlineJob && job && ["QUEUED", "RUNNING"].includes(job.status));
  const outlineBusy = isStarting || outlineRunning;
  const outlineFailed = Boolean(isOutlineJob && job?.status === "FAILED");

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>大纲</h3>
        <div className="memories-filter-buttons">
          <button type="button" className="btn-ghost" onClick={() => setAiOpen(true)}>
            ✨ AI 起草
          </button>
          <button type="button" className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            新建
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">加载中...</p>}

      {onGenerateOutline && (
        <div className="outline-batch">
          <span className="muted outline-batch-label">AI 批量生成细纲</span>
          <select
            aria-label="生成章节数"
            value={batchCount}
            onChange={(e) => setBatchCount(Number(e.target.value))}
            disabled={outlineBusy}
          >
            {[3, 5, 8, 10].map((count) => (
              <option key={count} value={count}>
                {count} 章
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost btn-small"
            onClick={() => onGenerateOutline(batchCount)}
            disabled={outlineBusy}
          >
            {outlineBusy ? "生成中..." : "生成细纲"}
          </button>
          {outlineFailed && <span className="form-error">{job?.errorMessage ?? "生成失败"}</span>}
        </div>
      )}

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

      <AiDraftDialog<OutlineDraft, {
        projectId: string;
        level: string;
        existingTitles: string[];
        startOrderIndex: number;
      }>
        open={aiOpen}
        title="AI 起草大纲节点"
        endpoint="/api/asset-drafts/outlines"
        fields={DRAFT_FIELDS}
        titleField="title"
        extraInputs={
          <label className="wizard-field">
            <span>层级</span>
            <select value={aiLevel} onChange={(e) => setAiLevel(e.target.value as typeof aiLevel)}>
              {LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
              ))}
            </select>
          </label>
        }
        extraPayload={{
          projectId,
          level: aiLevel,
          existingTitles: items.filter((i) => i.level === aiLevel).map((i) => i.title),
          startOrderIndex: items.filter((i) => i.level === aiLevel).length
        }}
        onAdopt={async (draft) => {
          const res = await fetch("/api/outlines", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              level: draft.level ?? aiLevel,
              title: draft.title,
              summary: draft.summary || undefined,
              orderIndex: draft.orderIndex ?? items.filter((i) => i.level === aiLevel).length
            })
          });
          const json = (await res.json()) as ApiEnvelope<unknown>;
          if (!res.ok || !json.success) throw new Error(json.error ?? "创建失败");
          await reload();
        }}
        onClose={() => setAiOpen(false)}
      />
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
