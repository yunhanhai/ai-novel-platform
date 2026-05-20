"use client";

import { useState } from "react";
import { useWorkspaceResource } from "./use-workspace-resource";
import { AiDraftDialog, type FieldSpec } from "./ai-draft-dialog";

export interface PlotThread {
  id: string;
  title: string;
  description: string | null;
  threadType: string;
  status: string;
  priority: number;
}

const ENDPOINT = "/api/plot-threads";
const TYPE_OPTIONS = [
  { value: "main", label: "主线" },
  { value: "side", label: "支线" },
  { value: "foreshadowing", label: "伏笔" },
  { value: "mystery", label: "悬念" },
  { value: "conflict", label: "冲突" }
];

const STATUS_FLOW: Array<{ from: string; to: string; label: string }> = [
  { from: "planted", to: "progressing", label: "推进中" },
  { from: "progressing", to: "deferred", label: "暂缓" },
  { from: "progressing", to: "resolved", label: "回收" },
  { from: "deferred", to: "progressing", label: "继续推进" },
  { from: "deferred", to: "resolved", label: "回收" },
  { from: "planted", to: "abandoned", label: "放弃" },
  { from: "deferred", to: "abandoned", label: "放弃" }
];

interface PlotThreadDraft extends Record<string, unknown> {
  title: string;
  threadType: string;
  description: string;
  priority: number;
}

const DRAFT_FIELDS: ReadonlyArray<FieldSpec<PlotThreadDraft>> = [
  { key: "title", label: "标题", control: "input" },
  { key: "threadType", label: "类型", control: "select", options: TYPE_OPTIONS },
  { key: "description", label: "描述（埋设+回收预期）", control: "textarea", rows: 3 }
];

export function PlotThreadsPanel({ projectId }: { projectId: string | null }) {
  const { items, isLoading, error, create, patch, deactivate } = useWorkspaceResource<PlotThread>({
    endpoint: ENDPOINT,
    projectId
  });

  const [title, setTitle] = useState("");
  const [threadType, setThreadType] = useState("foreshadowing");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !title.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await create({
        projectId,
        title: title.trim(),
        threadType,
        description: description.trim() || undefined,
        priority: priority || 0
      });
      setTitle("");
      setDescription("");
      setPriority(0);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (!projectId) return <p className="muted">请先选择一个项目</p>;

  return (
    <div className="resource-panel">
      <div className="resource-panel-header">
        <button type="button" className="btn-primary btn-small" onClick={() => setAiOpen(true)}>
          ✨ AI 帮我设计伏笔
        </button>
      </div>

      <form className="resource-form" onSubmit={handleCreate}>
        <h3>新建伏笔/线索</h3>
        <label>
          <span>标题 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="例如：主角胸前疤痕的来历" />
        </label>
        <label>
          <span>类型 *</span>
          <select value={threadType} onChange={(e) => setThreadType(e.target.value)}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>描述</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="埋设细节、回收预期" />
        </label>
        <label>
          <span>优先级</span>
          <input type="number" min={0} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
        </label>
        {formError && <p className="form-error">{formError}</p>}
        <button type="submit" className="btn-primary" disabled={submitting || !title.trim()}>
          {submitting ? "创建中..." : "创建"}
        </button>
      </form>

      <div className="resource-list">
        <h3>伏笔列表 ({items.length})</h3>
        {isLoading && <p className="muted">加载中...</p>}
        {error && <p className="form-error">{error}</p>}
        {!isLoading && !error && items.length === 0 && <p className="muted">尚未创建伏笔</p>}
        <ul className="resource-cards">
          {items.map((t) => (
            <PlotThreadCard
              key={t.id}
              item={t}
              onTransition={(status) => patch(t.id, { status })}
              onDelete={() => deactivate(t.id)}
            />
          ))}
        </ul>
      </div>

      <AiDraftDialog<PlotThreadDraft, { projectId: string; existingTitles: string[] }>
        open={aiOpen}
        title="AI 帮我设计伏笔 / 线索"
        endpoint="/api/asset-drafts/plot-threads"
        fields={DRAFT_FIELDS}
        titleField="title"
        extraPayload={{
          projectId,
          existingTitles: items.map((i) => i.title)
        }}
        onAdopt={async (draft) => {
          await create({
            projectId,
            title: draft.title,
            threadType: draft.threadType,
            description: draft.description || undefined,
            priority: draft.priority ?? 0
          });
        }}
        onClose={() => setAiOpen(false)}
      />
    </div>
  );
}

function PlotThreadCard({
  item,
  onTransition,
  onDelete
}: {
  item: PlotThread;
  onTransition: (status: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const transitions = STATUS_FLOW.filter((s) => s.from === item.status);
  return (
    <li className="resource-card">
      <div className="resource-card-header">
        <strong>{item.title}</strong>
        <span className={`tag tag-status-${item.status}`}>{labelOfStatus(item.status)}</span>
      </div>
      <p className="resource-card-brief">
        <span className="tag tag-method">{labelOfType(item.threadType)}</span>
        {item.description || <em className="muted">无描述</em>}
      </p>
      {transitions.length > 0 && (
        <div className="resource-card-actions">
          {transitions.map((tr) => (
            <button
              key={`${tr.from}-${tr.to}`}
              type="button"
              className="btn-ghost"
              onClick={() => void onTransition(tr.to)}
            >
              → {tr.label}
            </button>
          ))}
        </div>
      )}
      <div className="resource-card-actions">
        <button type="button" className="btn-ghost" onClick={() => void onDelete()}>删除</button>
      </div>
    </li>
  );
}

function labelOfType(t: string): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function labelOfStatus(s: string): string {
  switch (s) {
    case "planted": return "已埋";
    case "progressing": return "推进中";
    case "deferred": return "暂缓";
    case "resolved": return "已回收";
    case "abandoned": return "已放弃";
    default: return s;
  }
}
