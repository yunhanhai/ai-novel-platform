"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  preparationNotice?: string | null;
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

export function OutlinePanel({ projectId, job = null, isStarting = false, preparationNotice, onGenerateOutline, onGenerated }: Props) {
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
  const alive = useRef(false);
  const scope = useRef(0);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const listSequence = useRef(0);
  const mutationBusy = useRef(false);
  const isCurrent = (id: string | null, epoch: number) => alive.current && currentProject.current === id && scope.current === epoch;

  const reload = useCallback(async () => {
    if (!projectId) return;
    const epoch = scope.current, sequence = ++listSequence.current;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/outlines?projectId=${encodeURIComponent(projectId)}`);
      const json = (await res.json()) as ApiEnvelope<OutlineItem[]>;
      if (!isCurrent(projectId, epoch) || listSequence.current !== sequence) return;
      if (!res.ok || !json.success || !Array.isArray(json.data)) throw new Error(json.error ?? "大纲加载失败，请重试");
      setItems(json.data);
    } catch (err: unknown) {
      if (isCurrent(projectId, epoch) && listSequence.current === sequence) setError(err instanceof Error ? err.message : "大纲加载失败，请重试");
    } finally {
      if (isCurrent(projectId, epoch) && listSequence.current === sequence) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    setItems([]); resetForm(); setError(null);
    if (projectId) void reload();
    return () => { alive.current = false; scope.current++; listSequence.current++; };
  }, [projectId, reload]);

  useEffect(() => {
    if (job?.jobType === "GENERATE_OUTLINE" && job.status === "SUCCEEDED" && job.output?.projectId === projectId) {
      void reload();
      onGenerated?.();
    }
  }, [job?.jobType, job?.status, job?.id, job?.output, projectId, reload, onGenerated]);

  function resetForm() {
    setFormLevel("CHAPTER");
    setFormTitle("");
    setFormSummary("");
    setFormParentId("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(item: OutlineItem) {
    if (mutationBusy.current) return;
    setFormLevel(item.level);
    setFormTitle(item.title);
    setFormSummary(item.summary ?? "");
    setFormParentId(item.parentId ?? "");
    setEditingId(item.id);
    setShowForm(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !formTitle.trim() || mutationBusy.current) return;
    const id = projectId, epoch = scope.current;
    mutationBusy.current = true;
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
            summary: formSummary.trim()
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
            orderIndex: items.filter((i) => i.level === formLevel).reduce((max, item) => Math.max(max, item.orderIndex), -1) + 1
          })
        });
        const json = (await res.json()) as ApiEnvelope<OutlineItem>;
        if (!res.ok || !json.success) throw new Error(json.error ?? "创建失败");
      }
      if (!isCurrent(id, epoch)) return;
      resetForm();
      await reload();
    } catch (err: unknown) {
      if (isCurrent(id, epoch)) setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      mutationBusy.current = false; if (isCurrent(id, epoch)) setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (mutationBusy.current) return;
    if (!confirm("确定删除此大纲条目？")) return;
    const projectAtCall = projectId, epoch = scope.current;
    mutationBusy.current = true; setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/outlines/${id}`, { method: "DELETE" });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !json.success) throw new Error(json.error ?? "删除失败");
      if (isCurrent(projectAtCall, epoch)) await reload();
    } catch (err: unknown) {
      if (isCurrent(projectAtCall, epoch)) setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      mutationBusy.current = false; if (isCurrent(projectAtCall, epoch)) setSaving(false);
    }
  }

  if (!projectId) return <p className="muted">请先选择一个项目</p>;

  const itemsByLevel = groupBy(items, (i) => i.level);
  const jobProjectId = job?.output?.projectId ?? (job?.targetEntityType === "PROJECT" ? job.targetEntityId : job?.projectId);
  const isOutlineJob = job?.jobType === "GENERATE_OUTLINE" && jobProjectId === projectId;
  const outlineRunning = Boolean(isOutlineJob && job && ["QUEUED", "RUNNING"].includes(job.status));
  const outlineBusy = isStarting || outlineRunning;
  const outlineFailed = Boolean(isOutlineJob && job?.status === "FAILED");

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>大纲</h3>
        <div className="memories-filter-buttons">
          <button type="button" className="btn-ghost" disabled={saving} onClick={() => { if (!mutationBusy.current) setAiOpen(true); }}>
            ✨ AI 起草
          </button>
          <button type="button" className="btn-ghost" onClick={() => void reload()}>刷新</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => { if (!mutationBusy.current) { resetForm(); setShowForm(true); } }}>
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
          {preparationNotice && <span className="form-error" role="alert" aria-label="细纲准备提示">{preparationNotice}</span>}
        </div>
      )}

      {showForm && (
        <form className="resource-form" onSubmit={(e) => void handleSave(e)}>
          {!editingId && (
            <label>
              <span>层级</span>
              <select disabled={saving} value={formLevel} onChange={(e) => setFormLevel(e.target.value)}>
                {LEVEL_OPTIONS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>标题 *</span>
            <input disabled={saving} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} required maxLength={200} />
          </label>
          {!editingId && (
            <label>
              <span>父级</span>
              <select disabled={saving} value={formParentId} onChange={(e) => setFormParentId(e.target.value)}>
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
              disabled={saving}
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
                    <button type="button" className="btn-ghost" disabled={saving} onClick={() => startEdit(item)}>编辑</button>
                    <button type="button" className="btn-ghost" disabled={saving} onClick={() => void handleDelete(item.id)}>删除</button>
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
          const id = projectId, epoch = scope.current;
          if (!isCurrent(id, epoch)) throw new Error("项目已切换，请重新打开大纲草稿。");
          if (mutationBusy.current) throw new Error("请等待当前大纲保存完成。");
          mutationBusy.current = true; setSaving(true);
          try {
          const res = await fetch("/api/outlines", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: id,
              level: draft.level ?? aiLevel,
              title: draft.title,
              summary: draft.summary || undefined,
              orderIndex: draft.orderIndex ?? items.filter((i) => i.level === aiLevel).reduce((max, item) => Math.max(max, item.orderIndex), -1) + 1
            })
          });
          const json = (await res.json()) as ApiEnvelope<unknown>;
          if (!isCurrent(id, epoch)) return;
          if (!res.ok || !json.success) throw new Error(json.error ?? "创建失败");
          await reload();
          } finally {
            mutationBusy.current = false; if (isCurrent(id, epoch)) setSaving(false);
          }
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
