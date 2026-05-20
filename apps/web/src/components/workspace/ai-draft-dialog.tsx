"use client";

import { useState } from "react";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface FieldSpec<TDraft> {
  /** draft 对象上的 key */
  key: keyof TDraft;
  /** 中文显示 */
  label: string;
  /** input / textarea / select / tags */
  control: "input" | "textarea" | "select" | "tags";
  /** select 选项 */
  options?: Array<{ value: string; label: string }>;
  /** textarea rows，默认 2 */
  rows?: number;
  /** 不允许在卡片中编辑（仅展示） */
  readonly?: boolean;
}

interface AiDraftDialogProps<TDraft, TExtra extends Record<string, unknown>> {
  open: boolean;
  title: string;
  /** 已存在的草稿数量限制提示，例如 "1-10 条" */
  countHint?: string;
  /** 默认数量 */
  defaultCount?: number;
  /** 额外的输入字段（构造时拼到 draft endpoint 的 body） */
  extraInputs?: React.ReactNode;
  /** 当前的额外参数（由父组件维护） */
  extraPayload?: TExtra;
  /** draft 端点路径，例如 /api/asset-drafts/characters */
  endpoint: string;
  /** 渲染单张草稿卡片的字段配置 */
  fields: ReadonlyArray<FieldSpec<TDraft>>;
  /** 草稿卡片的主标题字段（用于显示） */
  titleField: keyof TDraft;
  /** 用户采纳单条 / 批量采纳时的提交函数（业务侧实现：拼最终 payload + 调原 create API） */
  onAdopt: (draft: TDraft) => Promise<void>;
  onClose: () => void;
  /** 当前已有条目的某个唯一字段值（用于去重提示，可选） */
  existingValues?: string[];
}

export function AiDraftDialog<TDraft extends Record<string, unknown>, TExtra extends Record<string, unknown> = Record<string, unknown>>(
  props: AiDraftDialogProps<TDraft, TExtra>
) {
  const {
    open,
    title,
    countHint = "1-10 条",
    defaultCount = 3,
    extraInputs,
    extraPayload,
    endpoint,
    fields,
    titleField,
    onAdopt,
    onClose
  } = props;

  const [count, setCount] = useState(defaultCount);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<TDraft[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adoptingIdx, setAdoptingIdx] = useState<number | null>(null);
  const [adoptError, setAdoptError] = useState<string | null>(null);
  const [batchAdopting, setBatchAdopting] = useState(false);

  if (!open) return null;

  async function handleGenerate() {
    setError(null);
    setAdoptError(null);
    setGenerating(true);
    setDrafts([]);
    try {
      const payload: Record<string, unknown> = {
        count: clampCount(count),
        extraPrompt: extraPrompt.trim() || undefined,
        ...(extraPayload ?? {})
      };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = (await res.json()) as ApiEnvelope<{ drafts: TDraft[]; degraded: boolean }>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `生成失败 (${res.status})`);
      }
      setDrafts(json.data.drafts);
      setDegraded(json.data.degraded);
      if (json.data.drafts.length === 0) {
        setError("AI 没有返回任何草稿，请调整描述后重试");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  function patchDraft(idx: number, patch: Partial<TDraft>) {
    setDrafts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  }

  async function handleAdoptOne(idx: number) {
    setAdoptingIdx(idx);
    setAdoptError(null);
    try {
      await onAdopt(drafts[idx]!);
      setDrafts((prev) => prev.filter((_, i) => i !== idx));
    } catch (err: unknown) {
      setAdoptError(err instanceof Error ? err.message : "采纳失败");
    } finally {
      setAdoptingIdx(null);
    }
  }

  function handleDiscard(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleAdoptAll() {
    setBatchAdopting(true);
    setAdoptError(null);
    const remaining: TDraft[] = [];
    for (const draft of drafts) {
      try {
        await onAdopt(draft);
      } catch (err: unknown) {
        remaining.push(draft);
        if (!adoptError) {
          setAdoptError(
            (err instanceof Error ? err.message : "采纳失败") + "（已停留在批量未完成的卡片上）"
          );
        }
        break;
      }
    }
    setDrafts(remaining);
    setBatchAdopting(false);
  }

  return (
    <div className="ai-draft-dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ai-draft-dialog">
        <header className="ai-draft-dialog-header">
          <h3>{title}</h3>
          <button type="button" className="btn-ghost btn-small" onClick={onClose}>
            ✕
          </button>
        </header>

        <section className="ai-draft-dialog-controls">
          <label className="wizard-field">
            <span>生成数量（{countHint}）</span>
            <input
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          {extraInputs}
          <label className="wizard-field">
            <span>补充说明（可选）</span>
            <textarea
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              rows={2}
              placeholder="例如：风格更暗黑 / 角色都来自同一家族 / 设在末日城市"
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            {generating ? "AI 生成中..." : drafts.length > 0 ? "♻ 重抽" : "✨ 生成草稿"}
          </button>
          {error && <p className="form-error">{error}</p>}
          {degraded && drafts.length > 0 && (
            <p className="muted ai-draft-degraded">
              ⚠ 当前为占位草稿（未连接真实模型）。你可以采纳后再手动改写。
            </p>
          )}
        </section>

        {drafts.length > 0 && (
          <section className="ai-draft-dialog-list">
            <div className="ai-draft-list-header">
              <span className="muted">共 {drafts.length} 条，逐条编辑后采纳，或一键全部采纳</span>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={() => void handleAdoptAll()}
                disabled={batchAdopting || adoptingIdx !== null}
              >
                {batchAdopting ? "采纳中..." : "✓ 全部采纳"}
              </button>
            </div>
            {adoptError && <p className="form-error">{adoptError}</p>}
            <ul className="ai-draft-cards">
              {drafts.map((draft, idx) => (
                <li key={idx} className="ai-draft-card">
                  <div className="ai-draft-card-title">
                    {String(draft[titleField] ?? `草稿 ${idx + 1}`)}
                  </div>
                  {fields.map((field) => (
                    <DraftField
                      key={String(field.key)}
                      field={field}
                      value={draft[field.key]}
                      onChange={(value) =>
                        patchDraft(idx, { [field.key]: value } as Partial<TDraft>)
                      }
                    />
                  ))}
                  <div className="ai-draft-card-actions">
                    <button
                      type="button"
                      className="btn-primary btn-small"
                      disabled={adoptingIdx === idx || batchAdopting}
                      onClick={() => void handleAdoptOne(idx)}
                    >
                      {adoptingIdx === idx ? "采纳中..." : "✓ 采纳"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-small"
                      disabled={adoptingIdx !== null || batchAdopting}
                      onClick={() => handleDiscard(idx)}
                    >
                      ✗ 丢弃
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function DraftField<TDraft>({
  field,
  value,
  onChange
}: {
  field: FieldSpec<TDraft>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.readonly) {
    return (
      <div className="ai-draft-field">
        <span className="muted">{field.label}</span>
        <span>{formatValue(value)}</span>
      </div>
    );
  }

  if (field.control === "select") {
    return (
      <label className="ai-draft-field">
        <span className="muted">{field.label}</span>
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.control === "textarea") {
    return (
      <label className="ai-draft-field">
        <span className="muted">{field.label}</span>
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={field.rows ?? 2}
        />
      </label>
    );
  }

  if (field.control === "tags") {
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    return (
      <label className="ai-draft-field">
        <span className="muted">{field.label}（逗号分隔）</span>
        <input
          type="text"
          value={arr.join("，")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(/[,，;；\n]/)
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
        />
      </label>
    );
  }

  return (
    <label className="ai-draft-field">
      <span className="muted">{field.label}</span>
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join("、");
  return String(value);
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(10, Math.floor(n)));
}
