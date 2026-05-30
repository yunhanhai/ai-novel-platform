"use client";

import { useState } from "react";
import { useWorkspaceResource } from "./use-workspace-resource";

export interface MemoryItem {
  id: string;
  memoryType: string;
  scopeType: string;
  scopeId: string | null;
  content: string;
  status: "proposed" | "accepted" | "rejected" | "superseded";
  confidence: number | string | null;
  sourceChapterId: string | null;
  sourceJobId: string | null;
  createdAt: string;
}

const ENDPOINT = "/api/project-memories";

const STATUS_FILTERS = [
  { value: "proposed", label: "待审核" },
  { value: "accepted", label: "已采纳" },
  { value: "rejected", label: "已驳回" },
  { value: "all", label: "全部" }
];

export function MemoriesPanel({ projectId }: { projectId: string | null }) {
  const [filter, setFilter] = useState<"proposed" | "accepted" | "rejected" | "all">("proposed");
  const { items, isLoading, error, patch, reload } = useWorkspaceResource<MemoryItem>({
    endpoint: ENDPOINT,
    projectId,
    listQuery: { status: filter === "all" ? undefined : filter }
  });

  if (!projectId) return <p className="muted">请先选择一个项目</p>;

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>项目记忆</h3>
        <div className="memories-filter-buttons">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`btn-ghost ${filter === s.value ? "active" : ""}`}
              onClick={() => setFilter(s.value as typeof filter)}
            >
              {s.label}
            </button>
          ))}
          <button type="button" className="btn-ghost" onClick={() => void reload()}>
            刷新
          </button>
        </div>
      </div>

      {isLoading && <p className="muted">加载中...</p>}
      {error && <p className="form-error">{error}</p>}
      {!isLoading && !error && items.length === 0 && (
        <p className="muted">没有匹配的记忆条目</p>
      )}

      <ul className="resource-cards">
        {items.map((m) => (
          <MemoryCard
            key={m.id}
            item={m}
            onAccept={() => patch(m.id, { status: "accepted" })}
            onReject={() => patch(m.id, { status: "rejected" })}
          />
        ))}
      </ul>

      <div className="memories-help">
        <p className="muted">
          记忆来自写后抽取，<strong>需要你确认才会成为项目真源</strong>。
          已驳回的记忆不会进入后续上下文。
        </p>
      </div>
    </div>
  );
}

function MemoryCard({
  item,
  onAccept,
  onReject
}: {
  item: MemoryItem;
  onAccept: () => Promise<unknown>;
  onReject: () => Promise<unknown>;
}) {
  return (
    <li className={`resource-card memory-card memory-${item.status}`}>
      <div className="resource-card-header">
        <span className="tag tag-method">{labelOfType(item.memoryType)}</span>
        <span className={`tag tag-memory-${item.status}`}>{labelOfStatus(item.status)}</span>
      </div>
      <p className="resource-card-brief">{item.content}</p>
      <p className="muted resource-card-meta">
        范围：{labelOfScope(item.scopeType)}
        {item.confidence !== null && ` · 置信度 ${formatConfidence(item.confidence)}`}
        {item.sourceChapterId && ` · 来自章节 ${item.sourceChapterId.slice(0, 8)}`}
      </p>
      {item.status === "proposed" && (
        <div className="resource-card-actions">
          <button type="button" className="btn-primary" onClick={() => void onAccept()}>
            采纳
          </button>
          <button type="button" className="btn-ghost" onClick={() => void onReject()}>
            驳回
          </button>
        </div>
      )}
    </li>
  );
}

function labelOfType(t: string): string {
  const map: Record<string, string> = {
    chapter_summary: "章节摘要",
    volume_summary: "卷摘要",
    character_state: "角色状态",
    world_fact: "世界事实",
    hook_status: "钩子状态",
    style_note: "风格备忘",
    continuity_note: "一致性备忘"
  };
  return map[t] ?? t;
}

function labelOfScope(s: string): string {
  const map: Record<string, string> = {
    project: "项目级",
    volume: "卷级",
    chapter: "章节级",
    character: "角色",
    world_item: "世界条目",
    plot_thread: "伏笔"
  };
  return map[s] ?? s;
}

function labelOfStatus(s: string): string {
  const map: Record<string, string> = {
    proposed: "待审核",
    accepted: "已采纳",
    rejected: "已驳回",
    superseded: "已过期"
  };
  return map[s] ?? s;
}

function formatConfidence(c: number | string): string {
  const n = typeof c === "string" ? Number(c) : c;
  if (Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}
