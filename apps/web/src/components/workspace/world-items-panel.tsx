"use client";

import { useState } from "react";
import { useWorkspaceResource } from "./use-workspace-resource";
import { AiDraftDialog, type FieldSpec } from "./ai-draft-dialog";

export interface WorldItem {
  id: string;
  name: string;
  itemType: string;
  aliases: string[] | null;
  summary: string | null;
  detail: string | null;
  activationKeywords: string[] | null;
  priority: number;
  status: string;
}

const ENDPOINT = "/api/world-items";
const ITEM_TYPE_OPTIONS = [
  { value: "location", label: "地点" },
  { value: "faction", label: "势力" },
  { value: "artifact", label: "道具" },
  { value: "rule", label: "规则" },
  { value: "power_system", label: "力量体系" },
  { value: "timeline_event", label: "时间事件" },
  { value: "creature", label: "生物" },
  { value: "other", label: "其他" }
];

interface WorldItemDraft extends Record<string, unknown> {
  name: string;
  itemType: string;
  aliases: string[];
  summary: string;
  detail: string;
  activationKeywords: string[];
  priority: number;
}

const DRAFT_FIELDS: ReadonlyArray<FieldSpec<WorldItemDraft>> = [
  { key: "name", label: "名称", control: "input" },
  { key: "itemType", label: "类型", control: "select", options: ITEM_TYPE_OPTIONS },
  { key: "aliases", label: "别名", control: "tags" },
  { key: "summary", label: "摘要", control: "textarea", rows: 2 },
  { key: "detail", label: "详细说明", control: "textarea", rows: 3 },
  { key: "activationKeywords", label: "激活关键词", control: "tags" }
];

export function WorldItemsPanel({ projectId }: { projectId: string | null }) {
  const { items, isLoading, error, create, patch, deactivate } = useWorkspaceResource<WorldItem>({
    endpoint: ENDPOINT,
    projectId
  });

  const [name, setName] = useState("");
  const [itemType, setItemType] = useState("location");
  const [summary, setSummary] = useState("");
  const [keywords, setKeywords] = useState("");
  const [priority, setPriority] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !name.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await create({
        projectId,
        name: name.trim(),
        itemType,
        summary: summary.trim() || undefined,
        activationKeywords: parseList(keywords),
        priority: priority || 0
      });
      setName("");
      setSummary("");
      setKeywords("");
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
          ✨ AI 帮我设计世界
        </button>
      </div>

      <form className="resource-form" onSubmit={handleCreate}>
        <h3>新建世界条目</h3>
        <label>
          <span>名称 *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} placeholder="例如：北境冰原" />
        </label>
        <label>
          <span>类型 *</span>
          <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
            {ITEM_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>摘要</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="一两句话描述" />
        </label>
        <label>
          <span>激活关键词（逗号分隔）</span>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="冰原, 北境, 雪城" />
        </label>
        <label>
          <span>优先级（数字越大越优先）</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            min={0}
          />
        </label>
        {formError && <p className="form-error">{formError}</p>}
        <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
          {submitting ? "创建中..." : "创建"}
        </button>
      </form>

      <div className="resource-list">
        <h3>世界观条目 ({items.length})</h3>
        {isLoading && <p className="muted">加载中...</p>}
        {error && <p className="form-error">{error}</p>}
        {!isLoading && !error && items.length === 0 && <p className="muted">尚无条目</p>}
        <ul className="resource-cards">
          {items.map((it) => (
            <WorldItemCard
              key={it.id}
              item={it}
              onUpdateSummary={(text) => patch(it.id, { summary: text })}
              onDelete={() => deactivate(it.id)}
            />
          ))}
        </ul>
      </div>

      <AiDraftDialog<WorldItemDraft, { projectId: string; existingNames: string[] }>
        open={aiOpen}
        title="AI 帮我设计世界观条目"
        endpoint="/api/asset-drafts/world-items"
        fields={DRAFT_FIELDS}
        titleField="name"
        extraPayload={{
          projectId,
          existingNames: items.map((i) => i.name)
        }}
        onAdopt={async (draft) => {
          await create({
            projectId,
            name: draft.name,
            itemType: draft.itemType,
            aliases: draft.aliases ?? [],
            summary: draft.summary || undefined,
            detail: draft.detail || undefined,
            activationKeywords: draft.activationKeywords ?? [],
            priority: draft.priority ?? 0
          });
        }}
        onClose={() => setAiOpen(false)}
      />
    </div>
  );
}

function WorldItemCard({
  item,
  onUpdateSummary,
  onDelete
}: {
  item: WorldItem;
  onUpdateSummary: (text: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.summary ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <li className="resource-card">
      <div className="resource-card-header">
        <strong>{item.name}</strong>
        <span className="tag tag-method">{labelOfType(item.itemType)}</span>
      </div>
      {editing ? (
        <div className="resource-card-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
          <div className="resource-card-edit-actions">
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>取消</button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onUpdateSummary(draft);
                  setEditing(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      ) : (
        <p className="resource-card-brief">{item.summary || <em className="muted">无摘要</em>}</p>
      )}
      {item.activationKeywords && item.activationKeywords.length > 0 && (
        <p className="muted resource-card-meta">关键词：{item.activationKeywords.join("、")}</p>
      )}
      <div className="resource-card-actions">
        {!editing && (
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>编辑摘要</button>
        )}
        <button type="button" className="btn-ghost" onClick={() => void onDelete()}>删除</button>
      </div>
    </li>
  );
}

function parseList(input: string): string[] {
  return input.split(/[,，;；\n]/).map((s) => s.trim()).filter(Boolean);
}

function labelOfType(t: string): string {
  return ITEM_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}
