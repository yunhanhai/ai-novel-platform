"use client";

import { useState } from "react";
import type { MethodType } from "@ai-novel/shared/methodology/templates";
import { METHODOLOGY_NONE } from "../../lib/wizard-options";

interface StepPremiseProps {
  projectTitle: string;
  genreTags: string[];
  styleTags: string[];
  methodology: MethodType | typeof METHODOLOGY_NONE;
  oneLiner: string;
  keyElements: string;
  premise: string;
  onChange: (patch: {
    oneLiner?: string;
    keyElements?: string;
    premise?: string;
  }) => void;
}

interface DraftResponse {
  success: boolean;
  data?: { text: string; degraded: boolean };
  error?: string;
}

export function StepPremise(props: StepPremiseProps) {
  const {
    projectTitle,
    genreTags,
    styleTags,
    methodology,
    oneLiner,
    keyElements,
    premise,
    onChange
  } = props;

  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDraft() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wizard/draft-premise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle,
          genreTags,
          styleTags,
          methodType: methodology === METHODOLOGY_NONE ? undefined : methodology,
          oneLiner,
          keyElements
        })
      });
      const json = (await res.json()) as DraftResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `生成失败 (${res.status})`);
      }
      onChange({ premise: json.data.text });
      setDegraded(json.data.degraded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  function handleAccept() {
    // 当前 premise 已经在状态中；这里仅做语义化操作（关闭降级提示）
    setDegraded(false);
  }

  function handleClear() {
    onChange({ premise: "" });
    setDegraded(false);
  }

  return (
    <div className="wizard-step-body">
      <h2 className="wizard-step-title">故事梗概</h2>
      <p className="muted wizard-step-hint">
        告诉我们一句话核心，AI 会帮你扩成完整梗概。你也可以直接跳过，进入工作台后再补。
      </p>

      <label className="wizard-field">
        <span>一句话核心</span>
        <input
          type="text"
          value={oneLiner}
          onChange={(e) => onChange({ oneLiner: e.target.value })}
          placeholder="例如：少年觉醒守护族人的力量"
          maxLength={200}
        />
      </label>

      <label className="wizard-field">
        <span>关键元素 / 主角设定</span>
        <textarea
          rows={3}
          value={keyElements}
          onChange={(e) => onChange({ keyElements: e.target.value })}
          placeholder="想看到的角色、世界设定、情感张力 …"
          maxLength={800}
        />
      </label>

      <div className="wizard-draft-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleDraft()}
          disabled={loading}
        >
          {loading ? "生成中…" : "✨ AI 帮我写梗概"}
        </button>
      </div>

      {degraded && (
        <p className="wizard-draft-degraded">当前为占位草稿（演示模式或降级），可继续编辑。</p>
      )}
      {error && <p className="form-error">{error}</p>}

      <label className="wizard-field">
        <span>梗概草稿（可直接编辑）</span>
        <textarea
          rows={6}
          value={premise}
          onChange={(e) => onChange({ premise: e.target.value })}
          placeholder="生成后会出现在这里。也可以直接手写。"
          maxLength={2000}
        />
        <div className="wizard-draft-actions">
          <button type="button" className="btn-ghost" onClick={handleAccept} disabled={!premise}>
            ✓ 采纳
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void handleDraft()}
            disabled={loading}
          >
            ♻ 重抽
          </button>
          <button type="button" className="btn-ghost" onClick={handleClear} disabled={!premise}>
            ✏ 清空自己写
          </button>
        </div>
      </label>
    </div>
  );
}
