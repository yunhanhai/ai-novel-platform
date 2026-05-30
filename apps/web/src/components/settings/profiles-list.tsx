"use client";

import { useEffect, useState } from "react";
import { ProfileForm, type ProfileFormValues, TASK_TYPES, type TaskType } from "./profile-form";
import { labelForTaskType } from "../../lib/display-labels";

interface ProfileItem {
  id: string;
  providerId: string;
  name: string;
  modelName: string;
  taskType: string;
  projectId: string | null;
  temperature: number | string | null;
  maxOutputTokens: number | null;
}

interface ProviderOption {
  id: string;
  name: string;
}

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; profile: ProfileItem };

export function ProfilesList() {
  const [items, setItems] = useState<ProfileItem[] | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });

  async function loadProfiles() {
    setError(null);
    try {
      const res = await fetch("/api/model-profiles");
      const json = (await res.json()) as { success: boolean; data?: ProfileItem[]; error?: string };
      if (!json.success || !json.data) throw new Error(json.error ?? "读取失败");
      setItems(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "读取失败");
    }
  }

  async function loadProviders() {
    try {
      const res = await fetch("/api/model-providers");
      const json = (await res.json()) as { success: boolean; data?: ProviderOption[] };
      if (json.success && json.data) {
        setProviders(json.data.map((p) => ({ id: p.id, name: p.name })));
      }
    } catch {
      // 忽略，主路径已经报错过
    }
  }

  useEffect(() => {
    void loadProfiles();
    void loadProviders();
  }, []);

  async function handleCreate(values: ProfileFormValues) {
    const payload: Record<string, unknown> = {
      providerId: values.providerId,
      name: values.name,
      modelName: values.modelName,
      taskType: values.taskType
    };
    const tempNum = Number(values.temperature);
    if (values.temperature !== "" && !Number.isNaN(tempNum)) payload.temperature = tempNum;
    const maxNum = Number(values.maxOutputTokens);
    if (values.maxOutputTokens !== "" && !Number.isNaN(maxNum)) payload.maxOutputTokens = maxNum;

    const res = await fetch("/api/model-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) throw new Error(json.error ?? `创建失败 (${res.status})`);
    setDialog({ mode: "closed" });
    await loadProfiles();
  }

  async function handleEdit(id: string, values: ProfileFormValues) {
    const payload: Record<string, unknown> = {
      name: values.name,
      modelName: values.modelName,
      taskType: values.taskType
    };
    if (values.temperature === "") {
      payload.temperature = null;
    } else {
      const num = Number(values.temperature);
      if (!Number.isNaN(num)) payload.temperature = num;
    }
    if (values.maxOutputTokens === "") {
      payload.maxOutputTokens = null;
    } else {
      const num = Number(values.maxOutputTokens);
      if (!Number.isNaN(num)) payload.maxOutputTokens = num;
    }

    const res = await fetch(`/api/model-profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) throw new Error(json.error ?? `保存失败 (${res.status})`);
    setDialog({ mode: "closed" });
    await loadProfiles();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("确定删除此模型档案？")) return;
    const res = await fetch(`/api/model-profiles/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) {
      setError(json.error ?? "删除失败");
      return;
    }
    await loadProfiles();
  }

  function providerName(id: string): string {
    return providers.find((p) => p.id === id)?.name ?? "（未知供应商）";
  }

  return (
    <section className="settings-card">
      <header className="settings-card-header">
        <h2>模型档案</h2>
        <button
          type="button"
          className="btn-primary btn-small"
          disabled={providers.length === 0}
          onClick={() => setDialog({ mode: "create" })}
        >
          + 新建档案
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}
      {providers.length === 0 && (
        <p className="muted">请先创建模型供应商，才能新增模型档案。</p>
      )}

      {items === null ? (
        <p className="muted">加载中...</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>没有模型档案。后台任务会回退到默认档案；建议至少创建一个任务类型为“默认”的档案。</p>
        </div>
      ) : (
        <ul className="settings-list">
          {items.map((p) => (
            <li key={p.id} className="settings-list-item">
              <div className="settings-list-main">
                <div className="settings-list-title">{p.name}</div>
                <div className="settings-list-meta">
                  <span>供应商：{providerName(p.providerId)}</span>
                  <span>模型: {p.modelName}</span>
                  <span>任务：{labelForTaskType(p.taskType)}</span>
                  {p.projectId && <span>项目专用</span>}
                  {p.temperature !== null && <span>随机性：{String(p.temperature)}</span>}
                  {p.maxOutputTokens !== null && <span>最大输出：{p.maxOutputTokens}</span>}
                </div>
              </div>
              <div className="settings-list-actions">
                <button
                  type="button"
                  className="btn-ghost btn-small"
                  onClick={() => setDialog({ mode: "edit", profile: p })}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-small danger"
                  onClick={() => void handleDelete(p.id)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog.mode === "create" && (
        <ProfileForm
          mode="create"
          providers={providers}
          onSubmit={handleCreate}
          onCancel={() => setDialog({ mode: "closed" })}
        />
      )}
      {dialog.mode === "edit" && (
        <ProfileForm
          mode="edit"
          providers={providers}
          initial={{
            providerId: dialog.profile.providerId,
            name: dialog.profile.name,
            modelName: dialog.profile.modelName,
            taskType: (TASK_TYPES as readonly string[]).includes(dialog.profile.taskType)
              ? (dialog.profile.taskType as TaskType)
              : "default",
            temperature:
              dialog.profile.temperature === null ? "" : String(dialog.profile.temperature),
            maxOutputTokens:
              dialog.profile.maxOutputTokens === null ? "" : String(dialog.profile.maxOutputTokens)
          }}
          onSubmit={(v) => handleEdit(dialog.profile.id, v)}
          onCancel={() => setDialog({ mode: "closed" })}
        />
      )}
    </section>
  );
}
