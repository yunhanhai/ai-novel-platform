"use client";

import { useState } from "react";

export const PROVIDER_TYPE_OPTIONS = [
  { value: "OPENAI_COMPATIBLE", label: "OpenAI 兼容", description: "GPT / Azure / 任何 OpenAI 协议" },
  { value: "ANTHROPIC", label: "Anthropic", description: "Claude 系列" },
  { value: "DEEPSEEK", label: "DeepSeek", description: "DeepSeek Reasoner / Chat" },
  { value: "GEMINI", label: "Gemini", description: "Google Gemini" },
  { value: "CUSTOM", label: "自定义", description: "通过 baseUrl 自托管或代理" }
] as const;

export type ProviderType = (typeof PROVIDER_TYPE_OPTIONS)[number]["value"];

export interface ProviderFormValues {
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  isDefault: boolean;
}

interface ProviderFormProps {
  mode: "create" | "edit";
  initial?: Partial<ProviderFormValues> & { id?: string };
  encryptionKeyConfigured: boolean;
  onSubmit: (values: ProviderFormValues) => Promise<void>;
  onCancel: () => void;
}

const DEFAULTS: ProviderFormValues = {
  name: "",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "",
  apiKey: "",
  isDefault: false
};

export function ProviderForm({ mode, initial, encryptionKeyConfigured, onSubmit, onCancel }: ProviderFormProps) {
  const [values, setValues] = useState<ProviderFormValues>({
    ...DEFAULTS,
    ...(initial ?? {})
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<ProviderFormValues>) {
    setValues((prev) => ({ ...prev, ...p }));
  }

  async function handleSubmit() {
    setError(null);
    if (!values.name.trim()) {
      setError("名称必填");
      return;
    }
    if (mode === "create" && !values.apiKey.trim()) {
      setError("API key 必填");
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

  const apiKeyDisabled = mode === "edit" || !encryptionKeyConfigured;

  return (
    <div className="settings-form">
      <label className="wizard-field">
        <span>名称</span>
        <input
          type="text"
          value={values.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="例如：默认 OpenAI"
        />
      </label>

      <label className="wizard-field">
        <span>类型</span>
        <select
          value={values.providerType}
          onChange={(e) => patch({ providerType: e.target.value as ProviderType })}
          disabled={mode === "edit"}
        >
          {PROVIDER_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} — {opt.description}
            </option>
          ))}
        </select>
      </label>

      <label className="wizard-field">
        <span>Base URL（可选）</span>
        <input
          type="text"
          value={values.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </label>

      <label className="wizard-field">
        <span>API Key{mode === "edit" ? "（编辑时不可修改，需删除后重建）" : ""}</span>
        <input
          type="password"
          value={values.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value })}
          placeholder={mode === "edit" ? "已加密存储" : "sk-..."}
          disabled={apiKeyDisabled}
        />
        {!encryptionKeyConfigured && mode === "create" && (
          <span className="form-hint warn">需先在 .env 配置 ENCRYPTION_KEY 才能保存 API key</span>
        )}
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="settings-form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={submitting}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleSubmit()}
          disabled={submitting || (mode === "create" && !encryptionKeyConfigured)}
        >
          {submitting ? "保存中..." : mode === "create" ? "创建" : "保存"}
        </button>
      </div>
    </div>
  );
}
