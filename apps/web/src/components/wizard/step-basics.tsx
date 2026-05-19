"use client";

import { PROJECT_TYPE_OPTIONS, type ProjectType } from "../../lib/wizard-options";
import { OptionCards } from "./option-cards";

interface StepBasicsProps {
  title: string;
  slug: string;
  type: ProjectType;
  onChange: (patch: { title?: string; slug?: string; type?: ProjectType }) => void;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

export function StepBasics({ title, slug, type, onChange }: StepBasicsProps) {
  return (
    <div className="wizard-step-body">
      <h2 className="wizard-step-title">基础信息</h2>
      <p className="muted wizard-step-hint">先告诉我们这部作品最基本的几件事</p>

      <label className="wizard-field">
        <span>作品名称 *</span>
        <input
          type="text"
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          required
          placeholder="例如：星河彼岸"
          maxLength={160}
        />
      </label>

      <label className="wizard-field">
        <span>标识符 *</span>
        <div className="wizard-inline-row">
          <input
            type="text"
            value={slug}
            onChange={(e) => onChange({ slug: e.target.value })}
            required
            placeholder="my-novel"
            pattern="[a-z0-9-]+"
            maxLength={120}
          />
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onChange({ slug: slugify(title) || "untitled" })}
            disabled={!title.trim()}
          >
            从名称生成
          </button>
        </div>
        <small className="muted">用于 URL，只能包含小写字母、数字、连字符</small>
      </label>

      <div className="wizard-field">
        <span>作品类型 *</span>
        <OptionCards
          mode="single"
          ariaLabel="作品类型"
          options={PROJECT_TYPE_OPTIONS}
          value={type}
          onChange={(next) => {
            if (next) onChange({ type: next });
          }}
        />
      </div>
    </div>
  );
}
