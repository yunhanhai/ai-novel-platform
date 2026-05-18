"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<"LONG_NOVEL" | "SHORT_STORY">("LONG_NOVEL");
  const [genre, setGenre] = useState("");
  const [styleBrief, setStyleBrief] = useState("");
  const [premise, setPremise] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !slug.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          slug: slug.trim(),
          type,
          genre: genre.trim() || undefined,
          styleBrief: styleBrief.trim() || undefined,
          premise: premise.trim() || undefined
        })
      });
      const json = (await res.json()) as { success: boolean; data?: { id: string }; error?: string };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `创建失败 (${res.status})`);
      }
      router.push(`/projects/${json.data.id}/workspace`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="projects-page">
      <div className="page-header">
        <h1>新建作品</h1>
      </div>
      <form className="project-form" onSubmit={handleSubmit}>
        <label>
          <span>作品名称</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="输入作品名称"
            maxLength={160}
          />
        </label>
        <label>
          <span>标识符</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="my-novel"
            pattern="[a-z0-9-]+"
            maxLength={120}
          />
        </label>
        <label>
          <span>类型</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="LONG_NOVEL">长篇小说</option>
            <option value="SHORT_STORY">短篇故事</option>
          </select>
        </label>
        <label>
          <span>题材</span>
          <input
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="如：奇幻、科幻、武侠"
            maxLength={80}
          />
        </label>
        <label>
          <span>风格简述</span>
          <input
            type="text"
            value={styleBrief}
            onChange={(e) => setStyleBrief(e.target.value)}
            placeholder="例如：冷峻克制、节奏紧凑"
          />
        </label>
        <label>
          <span>故事梗概（可选）</span>
          <textarea
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            placeholder="一句话或一段话概括"
            rows={3}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "创建中..." : "创建"}
        </button>
      </form>
    </div>
  );
}
