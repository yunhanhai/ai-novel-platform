"use client";

import { useMemo, useState } from "react";
import { useWorkspaceResource } from "./use-workspace-resource";

export interface StyleProfile {
  id: string;
  name: string;
  styleBrief: string | null;
  bannedWords: string[] | null;
  preferredWords: string[] | null;
  rhythmNotes: string | null;
  dialogueRatio: number | string | null;
  descriptionDensity: number | string | null;
  isActive: boolean;
  updatedAt: string;
}

const ENDPOINT = "/api/style-profiles";

export function StyleProfilePanel({ projectId }: { projectId: string | null }) {
  const { items, isLoading, error, create, patch, deactivate } = useWorkspaceResource<StyleProfile>({
    endpoint: ENDPOINT,
    projectId
  });

  const [name, setName] = useState("");
  const [styleBrief, setStyleBrief] = useState("");
  const [banned, setBanned] = useState("");
  const [preferred, setPreferred] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [items]
  );

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !name.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await create({
        projectId,
        name: name.trim(),
        styleBrief: styleBrief.trim() || undefined,
        bannedWords: parseList(banned),
        preferredWords: parseList(preferred)
      });
      setName("");
      setStyleBrief("");
      setBanned("");
      setPreferred("");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (!projectId) {
    return <p className="muted">请先选择一个项目</p>;
  }

  return (
    <div className="resource-panel">
      <form className="resource-form" onSubmit={handleCreate}>
        <h3>新建风格画像</h3>
        <label>
          <span>名称 *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：冷峻克制"
            required
            maxLength={120}
          />
        </label>
        <label>
          <span>风格简述</span>
          <textarea
            value={styleBrief}
            onChange={(e) => setStyleBrief(e.target.value)}
            placeholder="一两句话概括笔法风格"
            rows={2}
          />
        </label>
        <label>
          <span>禁用词（逗号分隔）</span>
          <input
            value={banned}
            onChange={(e) => setBanned(e.target.value)}
            placeholder="仿佛, 似乎, 居然"
          />
        </label>
        <label>
          <span>偏好词（逗号分隔）</span>
          <input
            value={preferred}
            onChange={(e) => setPreferred(e.target.value)}
            placeholder="决然, 倏地"
          />
        </label>
        {formError && <p className="form-error">{formError}</p>}
        <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
          {submitting ? "创建中..." : "创建"}
        </button>
      </form>

      <div className="resource-list">
        <h3>已有风格画像</h3>
        {isLoading && <p className="muted">加载中...</p>}
        {error && <p className="form-error">{error}</p>}
        {!isLoading && !error && sortedItems.length === 0 && (
          <p className="muted">尚未创建风格画像</p>
        )}
        <ul className="resource-cards">
          {sortedItems.map((item) => (
            <ProfileCard
              key={item.id}
              item={item}
              onToggle={() =>
                item.isActive ? deactivate(item.id) : patch(item.id, { isActive: true })
              }
              onUpdateBrief={(text) => patch(item.id, { styleBrief: text })}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProfileCard({
  item,
  onToggle,
  onUpdateBrief
}: {
  item: StyleProfile;
  onToggle: () => Promise<unknown>;
  onUpdateBrief: (text: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.styleBrief ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await onUpdateBrief(draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`resource-card ${item.isActive ? "active" : "inactive"}`}>
      <div className="resource-card-header">
        <strong>{item.name}</strong>
        <span className={item.isActive ? "tag tag-active" : "tag tag-muted"}>
          {item.isActive ? "启用中" : "已停用"}
        </span>
      </div>
      {editing ? (
        <div className="resource-card-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
          <div className="resource-card-edit-actions">
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      ) : (
        <p className="resource-card-brief">{item.styleBrief || <em className="muted">未填写简介</em>}</p>
      )}
      <div className="resource-card-meta">
        <span className="muted">
          对白 {formatRatio(item.dialogueRatio)} · 描写 {formatRatio(item.descriptionDensity)}
        </span>
      </div>
      <div className="resource-card-actions">
        {!editing && (
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
            编辑简介
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={() => void onToggle()}>
          {item.isActive ? "停用" : "重新启用"}
        </button>
      </div>
    </li>
  );
}

function parseList(input: string): string[] {
  return input
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatRatio(value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "—";
  return `${Math.round(num * 100)}%`;
}
