"use client";

import { useEffect, useState } from "react";
import {
  getMethodologyTemplate,
  type MethodType
} from "@ai-novel/shared/methodology/templates";
import { METHODOLOGY_NONE } from "../../lib/wizard-options";

type Level = "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";

export interface OutlineNodeDraft {
  level: Level;
  title: string;
  summary: string;
  orderIndex: number;
}

interface StepOutlineProps {
  methodology: MethodType | typeof METHODOLOGY_NONE;
  genreTags: string[];
  styleTags: string[];
  premise: string;
  outlineNodes: OutlineNodeDraft[];
  onChange: (patch: { outlineNodes?: OutlineNodeDraft[] }) => void;
}

interface DraftResponse {
  success: boolean;
  data?: { nodes: OutlineNodeDraft[]; degraded: boolean };
  error?: string;
}

function toUpperLevel(level: "book" | "volume" | "chapter" | "beat"): Level {
  switch (level) {
    case "book": return "BOOK";
    case "volume": return "VOLUME";
    case "chapter": return "CHAPTER";
    case "beat": return "BEAT";
  }
}

function buildSkeletonNodes(methodType: MethodType): OutlineNodeDraft[] {
  try {
    const tmpl = getMethodologyTemplate(methodType);
    return tmpl.outlineMetadata.nodes.map((n) => ({
      level: toUpperLevel(n.level),
      title: n.title,
      summary: n.summary,
      orderIndex: n.orderIndex
    }));
  } catch {
    return [];
  }
}

export function StepOutline(props: StepOutlineProps) {
  const { methodology, genreTags, styleTags, premise, outlineNodes, onChange } = props;

  const isMethodologyChosen = methodology !== METHODOLOGY_NONE && methodology !== "custom";

  useEffect(() => {
    if (!isMethodologyChosen) return;
    if (outlineNodes.length > 0) return;
    const skeleton = buildSkeletonNodes(methodology as MethodType);
    if (skeleton.length > 0) {
      onChange({ outlineNodes: skeleton });
    }
    // 仅在 methodology 切换或首次进入时预填
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodology]);

  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDraft() {
    if (!isMethodologyChosen) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wizard/draft-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          methodType: methodology,
          genreTags,
          styleTags,
          premise
        })
      });
      const json = (await res.json()) as DraftResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `生成失败 (${res.status})`);
      }
      onChange({ outlineNodes: json.data.nodes });
      setDegraded(json.data.degraded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  function updateNode(index: number, patch: Partial<OutlineNodeDraft>) {
    const next = outlineNodes.map((n, i) => (i === index ? { ...n, ...patch } : n));
    onChange({ outlineNodes: next });
  }

  function removeNode(index: number) {
    const next = outlineNodes.filter((_, i) => i !== index);
    onChange({ outlineNodes: next });
  }

  if (methodology === METHODOLOGY_NONE) {
    return (
      <div className="wizard-step-body">
        <h2 className="wizard-step-title">大纲骨架</h2>
        <p className="muted wizard-step-hint">
          上一步没有选方法论，本步骤可跳过。你也可以返回上一步选一个方法论再来生成骨架。
        </p>
      </div>
    );
  }

  if (methodology === "custom") {
    return (
      <div className="wizard-step-body">
        <h2 className="wizard-step-title">大纲骨架</h2>
        <p className="muted wizard-step-hint">
          自定义方法论暂不预填骨架，请进入工作台后自行编写大纲与审查规则。
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-step-body">
      <h2 className="wizard-step-title">大纲骨架</h2>
      <p className="muted wizard-step-hint">
        以下是方法论提供的骨架。可直接编辑标题/摘要，也可让 AI 扩写每条摘要。
      </p>

      <div className="wizard-draft-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleDraft()}
          disabled={loading || outlineNodes.length === 0}
        >
          {loading ? "扩写中…" : "✨ 让 AI 把摘要扩写"}
        </button>
      </div>

      {degraded && (
        <p className="wizard-draft-degraded">当前为占位骨架（演示模式或降级），可继续编辑。</p>
      )}
      {error && <p className="form-error">{error}</p>}

      <ul className="wizard-outline-list">
        {outlineNodes.map((node, index) => (
          <li key={`${node.orderIndex}-${index}`} className="wizard-outline-item">
            <div className="wizard-outline-row">
              <span className="wizard-outline-level">{node.level}</span>
              <input
                type="text"
                value={node.title}
                onChange={(e) => updateNode(index, { title: e.target.value })}
                placeholder="标题"
                maxLength={160}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => removeNode(index)}
                aria-label="删除此节点"
              >
                删除
              </button>
            </div>
            <textarea
              rows={2}
              value={node.summary}
              onChange={(e) => updateNode(index, { summary: e.target.value })}
              placeholder="摘要"
              maxLength={1000}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
