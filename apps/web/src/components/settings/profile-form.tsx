"use client";

import { useState } from "react";

export const TASK_TYPES = [
  "default",
  "generate_chapter",
  "generate_outline",
  "deslop",
  "extract_memory",
  "rewrite",
  "polish",
  "review",
  "continue_chapter"
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export interface ProfileFormValues {
  providerId: string;
  name: string;
  modelName: string;
  taskType: TaskType;
  temperature: string;
  maxOutputTokens: string;
}

interface ProviderOption {
  id: string;
  name: string;
}

interface ProfileFormProps {
  mode: "create" | "edit";
  initial?: Partial<ProfileFormValues>;
  providers: ProviderOption[];
  onSubmit: (values: ProfileFormValues) => Promise<void>;
  onCancel: () => void;
}

const DEFAULTS: ProfileFormValues = {
  providerId: "",
  name: "",
  modelName: "",
  taskType: "default",
  temperature: "",
  maxOutputTokens: ""
};

export function ProfileForm({ mode, initial, providers, onSubmit, onCancel }: ProfileFormProps) {
  const [values, setValues] = useState<ProfileFormValues>({
    ...DEFAULTS,
    providerId: providers[0]?.id ?? "",
    ...(initial ?? {})
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<ProfileFormValues>) {
    setValues((prev) => ({ ...prev, ...p }));
  }

  async function handleSubmit() {
    setError(null);
    if (!values.providerId) {
      setError("请先选择一个 Provider");
      return;
    }
    if (!values.name.trim() || !values.modelName.trim()) {
      setError("名称和模型 ID 必填");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="settings-form">
      <label className="wizard-field">
        <span>Provider</span>
        <select
          value={values.providerId}
          onChange={(e) => patch({ providerId: e.target.value })}
          disabled={mode === "edit"}
        >
          {providers.length === 0 && <option value="">（请先创建 Provider）</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className="wizard-field">
        <span>档案名称</span>
        <input
          type="text"
          value={values.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="例如：默认生成档案"
        />
      </label>

      <label className="wizard-field">
        <span>模型 ID</span>
        <input
          type="text"
          value={values.modelName}
          onChange={(e) => patch({ modelName: e.target.value })}
          placeholder="例如：gpt-4o-mini / claude-3-5-sonnet"
        />
      </label>

      <label className="wizard-field">
        <span>任务类型</span>
        <select
          value={values.taskType}
          onChange={(e) => patch({ taskType: e.target.value as TaskType })}
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <div className="wizard-inline-row">
        <label className="wizard-field">
          <span>Temperature（0-1，可空）</span>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={values.temperature}
            onChange={(e) => patch({ temperature: e.target.value })}
          />
        </label>
        <label className="wizard-field">
          <span>Max Output Tokens（可空）</span>
          <input
            type="number"
            min="1"
            value={values.maxOutputTokens}
            onChange={(e) => patch({ maxOutputTokens: e.target.value })}
          />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="settings-form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={submitting}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleSubmit()}
          disabled={submitting || providers.length === 0}
        >
          {submitting ? "保存中..." : mode === "create" ? "创建" : "保存"}
        </button>
      </div>
    </div>
  );
}
