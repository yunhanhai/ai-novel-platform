"use client";

import { useMemo, useState } from "react";
import { listMethodologyTemplates, type MethodType } from "@ai-novel/shared/methodology/templates";
import { useWorkspaceResource } from "./use-workspace-resource";

export interface Methodology {
  id: string;
  name: string;
  methodType: string;
  description: string | null;
  outlineMetadata: { nodes?: Array<{ title: string; level: string; summary: string }> } | null;
  reviewCriteria: { structureChecks?: string[]; pacingChecks?: string[]; forbiddenMoves?: string[] } | null;
  isActive: boolean;
  updatedAt: string;
}

const ENDPOINT = "/api/writing-methodologies";

export function MethodologyPanel({ projectId }: { projectId: string | null }) {
  const { items, isLoading, error, create, patch, deactivate } = useWorkspaceResource<Methodology>({
    endpoint: ENDPOINT,
    projectId
  });

  const [submitting, setSubmitting] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [items]
  );

  const templates = useMemo(() => listMethodologyTemplates(), []);

  async function handleCreateFromTemplate(methodType: MethodType) {
    if (!projectId) return;
    setSubmitting(methodType);
    setFormError(null);
    try {
      await create({ projectId, methodType }, { fromTemplate: "true" });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(null);
    }
  }

  if (!projectId) {
    return <p className="muted">请先选择一个项目</p>;
  }

  return (
    <div className="resource-panel">
      <div className="methodology-templates">
        <h3>从模板创建</h3>
        <p className="muted">一键导入内置方法论，可在创建后再修改</p>
        <ul className="template-grid">
          {templates.map((t) => (
            <li key={t.methodType}>
              <button
                type="button"
                className="template-card"
                disabled={submitting !== null}
                onClick={() => handleCreateFromTemplate(t.methodType)}
              >
                <strong>{t.name}</strong>
                <span className="muted">{t.description}</span>
                <span className="template-action">
                  {submitting === t.methodType ? "创建中..." : "+ 使用此模板"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {formError && <p className="form-error">{formError}</p>}
      </div>

      <div className="resource-list">
        <h3>已有方法论</h3>
        {isLoading && <p className="muted">加载中...</p>}
        {error && <p className="form-error">{error}</p>}
        {!isLoading && !error && sortedItems.length === 0 && (
          <p className="muted">尚未创建方法论</p>
        )}
        <ul className="resource-cards">
          {sortedItems.map((item) => (
            <MethodologyCard
              key={item.id}
              item={item}
              onToggle={() =>
                item.isActive ? deactivate(item.id) : patch(item.id, { isActive: true })
              }
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function MethodologyCard({
  item,
  onToggle
}: {
  item: Methodology;
  onToggle: () => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const nodes = item.outlineMetadata?.nodes ?? [];
  const checks = item.reviewCriteria?.structureChecks ?? [];

  return (
    <li className={`resource-card ${item.isActive ? "active" : "inactive"}`}>
      <div className="resource-card-header">
        <strong>{item.name}</strong>
        <span className={item.isActive ? "tag tag-active" : "tag tag-muted"}>
          {item.isActive ? "启用中" : "已停用"}
        </span>
      </div>
      <p className="resource-card-brief">
        <span className="tag tag-method">{labelOf(item.methodType)}</span>{" "}
        {item.description || <em className="muted">无描述</em>}
      </p>

      {expanded && (
        <div className="methodology-detail">
          {nodes.length > 0 && (
            <>
              <h4>大纲骨架</h4>
              <ol className="outline-skeleton">
                {nodes.map((n, i) => (
                  <li key={i}>
                    <span className="outline-level">[{n.level}]</span>
                    <strong>{n.title}</strong>
                    <span className="muted">{n.summary}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {checks.length > 0 && (
            <>
              <h4>结构审查</h4>
              <ul>
                {checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="resource-card-actions">
        <button type="button" className="btn-ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起" : "查看详情"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void onToggle()}>
          {item.isActive ? "停用" : "重新启用"}
        </button>
      </div>
    </li>
  );
}

function labelOf(methodType: string): string {
  const map: Record<string, string> = {
    snowflake: "雪花",
    three_act: "三幕",
    four_act: "四幕",
    webnovel_speed: "网文爽点",
    romance_rhythm: "言情",
    short_reversal: "短篇反转",
    custom: "自定义"
  };
  return map[methodType] ?? methodType;
}
