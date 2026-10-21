"use client";

import { useCallback, useEffect, useState } from "react";

interface ProjectDetail {
  id: string;
  title: string;
  genre: string | null;
  styleBrief: string | null;
  premise: string | null;
  status: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Props {
  projectId: string | null;
  onSaved?: () => void;
}

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "草稿" },
  { value: "ACTIVE", label: "连载中" },
  { value: "PAUSED", label: "暂停" },
  { value: "ARCHIVED", label: "已归档" }
];

// 项目信息编辑：梗概与风格基调在创建向导之后仍可调整。
// 这两项直接影响生成时的上下文组装，改完无需重启任何进程。
export function ProjectInfoPanel({ projectId, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [styleBrief, setStyleBrief] = useState("");
  const [premise, setPremise] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const json = (await res.json()) as ApiEnvelope<ProjectDetail>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `加载失败 (${res.status})`);
      }
      setTitle(json.data.title);
      setGenre(json.data.genre ?? "");
      setStyleBrief(json.data.styleBrief ?? "");
      setPremise(json.data.premise ?? "");
      setStatus(json.data.status);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载项目信息失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          genre: genre.trim() || null,
          styleBrief: styleBrief.trim() || null,
          premise: premise.trim() || null,
          status
        })
      });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `保存失败 (${res.status})`);
      }
      setSavedAt(Date.now());
      onSaved?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!projectId) return <p className="muted">请先选择一个项目</p>;
  if (loading) return <p className="muted">加载中...</p>;

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>作品信息</h3>
      </div>

      {error && <p className="form-error">{error}</p>}
      {savedAt && !error && <p className="form-hint">已保存，后续生成会使用新的设定。</p>}

      <form className="resource-form" onSubmit={handleSave}>
        <label>
          标题
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          题材
          <input
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="如：古装悬疑"
          />
        </label>
        <label>
          状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          风格基调
          <textarea
            rows={3}
            value={styleBrief}
            onChange={(e) => setStyleBrief(e.target.value)}
            placeholder="如：冷峻克制，短句为主，避免抒情"
          />
        </label>
        <label>
          故事梗概
          <textarea
            rows={6}
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            placeholder="主角、冲突、走向——生成章节与细纲都会读取这里"
          />
        </label>
        <div className="resource-form-actions">
          <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
