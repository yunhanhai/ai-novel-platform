"use client";

import { useState } from "react";
import { useWorkspaceResource } from "./use-workspace-resource";

export interface CharacterItem {
  id: string;
  name: string;
  roleType: string;
  aliases: string[] | null;
  personality: string | null;
  motivation: string | null;
  speechPattern: string | null;
  arc: string | null;
  status: string;
}

const ENDPOINT = "/api/characters";
const ROLE_OPTIONS = [
  { value: "protagonist", label: "主角" },
  { value: "antagonist", label: "反派" },
  { value: "supporting", label: "配角" },
  { value: "minor", label: "次要" }
];

export function CharactersPanel({ projectId }: { projectId: string | null }) {
  const { items, isLoading, error, create, patch, deactivate } = useWorkspaceResource<CharacterItem>({
    endpoint: ENDPOINT,
    projectId
  });

  const [name, setName] = useState("");
  const [roleType, setRoleType] = useState("supporting");
  const [aliases, setAliases] = useState("");
  const [personality, setPersonality] = useState("");
  const [motivation, setMotivation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !name.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await create({
        projectId,
        name: name.trim(),
        roleType,
        aliases: parseList(aliases),
        personality: personality.trim() || undefined,
        motivation: motivation.trim() || undefined
      });
      setName("");
      setAliases("");
      setPersonality("");
      setMotivation("");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (!projectId) return <p className="muted">请先选择一个项目</p>;

  return (
    <div className="resource-panel">
      <form className="resource-form" onSubmit={handleCreate}>
        <h3>新建角色</h3>
        <label>
          <span>姓名 *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="例如：林无忌" />
        </label>
        <label>
          <span>角色类型 *</span>
          <select value={roleType} onChange={(e) => setRoleType(e.target.value)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>别名（逗号分隔）</span>
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="无忌, 林少" />
        </label>
        <label>
          <span>性格</span>
          <input value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="冷静、寡言" />
        </label>
        <label>
          <span>动机</span>
          <input value={motivation} onChange={(e) => setMotivation(e.target.value)} placeholder="复仇 / 寻亲" />
        </label>
        {formError && <p className="form-error">{formError}</p>}
        <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
          {submitting ? "创建中..." : "创建"}
        </button>
      </form>

      <div className="resource-list">
        <h3>角色列表 ({items.length})</h3>
        {isLoading && <p className="muted">加载中...</p>}
        {error && <p className="form-error">{error}</p>}
        {!isLoading && !error && items.length === 0 && <p className="muted">尚未创建角色</p>}
        <ul className="resource-cards">
          {items.map((c) => (
            <CharacterCard
              key={c.id}
              item={c}
              onUpdateField={(field, value) => patch(c.id, { [field]: value })}
              onDelete={() => deactivate(c.id)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CharacterCard({
  item,
  onUpdateField,
  onDelete
}: {
  item: CharacterItem;
  onUpdateField: (field: string, value: unknown) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(item.personality ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <li className="resource-card">
      <div className="resource-card-header">
        <strong>{item.name}</strong>
        <span className="tag tag-method">{labelOfRole(item.roleType)}</span>
      </div>
      {item.aliases && item.aliases.length > 0 && (
        <p className="muted resource-card-meta">别名：{item.aliases.join("、")}</p>
      )}
      <p className="resource-card-brief">
        {item.personality || <em className="muted">未填写性格</em>}
      </p>
      {expanded && (
        <div className="resource-card-edit">
          <label className="muted">编辑性格</label>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
          <div className="resource-card-edit-actions">
            <button type="button" className="btn-ghost" onClick={() => setExpanded(false)} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onUpdateField("personality", draft);
                  setExpanded(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "保存中" : "保存"}
            </button>
          </div>
          {item.motivation && (
            <p className="muted">动机：{item.motivation}</p>
          )}
          {item.arc && <p className="muted">弧光：{item.arc}</p>}
        </div>
      )}
      <div className="resource-card-actions">
        <button type="button" className="btn-ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起" : "查看 / 编辑"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void onDelete()}>
          删除
        </button>
      </div>
    </li>
  );
}

function parseList(input: string): string[] {
  return input.split(/[,，;；\n]/).map((s) => s.trim()).filter(Boolean);
}

function labelOfRole(role: string): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}
