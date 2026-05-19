"use client";

import { useEffect, useState } from "react";
import { ProviderForm, type ProviderFormValues } from "./provider-form";

interface ProviderItem {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  status: string;
  isDefault: boolean;
  encryptedApiKey: string;
}

interface ProvidersListProps {
  encryptionKeyConfigured: boolean;
}

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; provider: ProviderItem };

export function ProvidersList({ encryptionKeyConfigured }: ProvidersListProps) {
  const [items, setItems] = useState<ProviderItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/model-providers");
      const json = (await res.json()) as { success: boolean; data?: ProviderItem[]; error?: string };
      if (!json.success || !json.data) throw new Error(json.error ?? "读取失败");
      setItems(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "读取失败");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(values: ProviderFormValues) {
    const res = await fetch("/api/model-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        providerType: values.providerType,
        apiKey: values.apiKey,
        ...(values.baseUrl ? { baseUrl: values.baseUrl } : {}),
        isDefault: values.isDefault
      })
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) throw new Error(json.error ?? `创建失败 (${res.status})`);
    setDialog({ mode: "closed" });
    await load();
  }

  async function handleEdit(id: string, values: ProviderFormValues) {
    const res = await fetch(`/api/model-providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        baseUrl: values.baseUrl || undefined,
        isDefault: values.isDefault
      })
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) throw new Error(json.error ?? `保存失败 (${res.status})`);
    setDialog({ mode: "closed" });
    await load();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("确定停用此 Provider？此操作会把状态置为 DISABLED。")) return;
    const res = await fetch(`/api/model-providers/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) {
      setError(json.error ?? "删除失败");
      return;
    }
    await load();
  }

  async function handleTest(id: string) {
    setTestResult((prev) => ({ ...prev, [id]: { ok: false, msg: "测试中..." } }));
    try {
      const res = await fetch(`/api/model-providers/${id}/test`, { method: "POST" });
      const json = (await res.json()) as { success: boolean; data?: { ok: boolean; mode?: string; error?: string; note?: string } };
      if (json.success && json.data) {
        const { ok, mode, error: errMsg, note } = json.data;
        const msg = ok ? `连通成功（${mode ?? "ok"}${note ? `：${note}` : ""}）` : errMsg ?? "连通失败";
        setTestResult((prev) => ({ ...prev, [id]: { ok, msg } }));
      } else {
        setTestResult((prev) => ({ ...prev, [id]: { ok: false, msg: "测试请求失败" } }));
      }
    } catch (err: unknown) {
      setTestResult((prev) => ({
        ...prev,
        [id]: { ok: false, msg: err instanceof Error ? err.message : "测试请求异常" }
      }));
    }
  }

  return (
    <section className="settings-card">
      <header className="settings-card-header">
        <h2>模型 Provider</h2>
        <button
          type="button"
          className="btn-primary btn-small"
          onClick={() => setDialog({ mode: "create" })}
        >
          + 新建 Provider
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}

      {items === null ? (
        <p className="muted">加载中...</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>还没有 Provider，新建一个连接到 OpenAI / Anthropic 等供应商。</p>
        </div>
      ) : (
        <ul className="settings-list">
          {items.map((p) => (
            <li key={p.id} className="settings-list-item">
              <div className="settings-list-main">
                <div className="settings-list-title">
                  {p.name}
                  {p.isDefault && <span className="badge">默认</span>}
                </div>
                <div className="settings-list-meta">
                  <span>{p.providerType}</span>
                  {p.baseUrl && <span>{p.baseUrl}</span>}
                  <span>状态：{p.status}</span>
                </div>
                {testResult[p.id] && (
                  <p className={`settings-list-test ${testResult[p.id]!.ok ? "ok" : "err"}`}>
                    {testResult[p.id]!.msg}
                  </p>
                )}
              </div>
              <div className="settings-list-actions">
                <button type="button" className="btn-ghost btn-small" onClick={() => void handleTest(p.id)}>
                  测试连接
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-small"
                  onClick={() => setDialog({ mode: "edit", provider: p })}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-small danger"
                  onClick={() => void handleDelete(p.id)}
                >
                  停用
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog.mode === "create" && (
        <ProviderForm
          mode="create"
          encryptionKeyConfigured={encryptionKeyConfigured}
          onSubmit={handleCreate}
          onCancel={() => setDialog({ mode: "closed" })}
        />
      )}
      {dialog.mode === "edit" && (
        <ProviderForm
          mode="edit"
          encryptionKeyConfigured={encryptionKeyConfigured}
          initial={{
            name: dialog.provider.name,
            providerType: dialog.provider.providerType as ProviderFormValues["providerType"],
            baseUrl: dialog.provider.baseUrl ?? "",
            apiKey: "",
            isDefault: dialog.provider.isDefault
          }}
          onSubmit={(v) => handleEdit(dialog.provider.id, v)}
          onCancel={() => setDialog({ mode: "closed" })}
        />
      )}
    </section>
  );
}
