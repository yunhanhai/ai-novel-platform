"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContextAsset, ContextBudgetPreset, ContextOptions } from "@ai-novel/shared/context-composer/types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ContextPreview {
  budgetPreset: ContextBudgetPreset;
  tokenBudget: number;
  estimatedTokens: number;
  included: ContextAsset[];
  trimmed: ContextAsset[];
  available: ContextAsset[];
  excluded: ContextAsset[];
  forced: ContextAsset[];
  required: ContextAsset[];
  promptPreview: string;
}

interface Props {
  chapterId: string | null;
  disabled?: boolean;
  onChange: (options: ContextOptions | undefined) => void;
}

const BUDGETS: Array<{ value: ContextBudgetPreset; label: string }> = [
  { value: "compact", label: "精简" },
  { value: "standard", label: "标准" },
  { value: "rich", label: "丰富" }
];

export function ContextComposer({ chapterId, disabled, onChange }: Props) {
  const [budgetPreset, setBudgetPreset] = useState<ContextBudgetPreset>("standard");
  const [excludedAssetIds, setExcludedAssetIds] = useState<string[]>([]);
  const [forcedAssetIds, setForcedAssetIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo<ContextOptions>(() => ({ budgetPreset, excludedAssetIds, forcedAssetIds }), [budgetPreset, excludedAssetIds, forcedAssetIds]);

  useEffect(() => {
    onChange(chapterId ? options : undefined);
  }, [chapterId, onChange, options]);

  const loadPreview = useCallback(async () => {
    if (!chapterId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/context-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextOptions: options })
      });
      const json = (await res.json()) as ApiEnvelope<ContextPreview>;
      if (!res.ok || !json.success || !json.data) throw new Error(json.error ?? `请求失败 (${res.status})`);
      setPreview(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "上下文预览失败");
    } finally {
      setLoading(false);
    }
  }, [chapterId, options]);

  useEffect(() => {
    setExcludedAssetIds([]);
    setForcedAssetIds([]);
    setPreview(null);
  }, [chapterId]);

  useEffect(() => {
    if (chapterId) void loadPreview();
  }, [chapterId, loadPreview]);

  function toggleExcluded(assetId: string) {
    setExcludedAssetIds((current) => current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]);
  }

  function toggleForced(assetId: string) {
    setForcedAssetIds((current) => current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]);
  }

  return (
    <section className="context-composer" aria-label="上下文编排器">
      <div className="context-composer-header">
        <h4>上下文</h4>
        <button type="button" className="btn-ghost btn-small" onClick={() => void loadPreview()} disabled={!chapterId || disabled || isLoading}>
          {isLoading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className="segmented-control" role="group" aria-label="上下文预算">
        {BUDGETS.map((budget) => (
          <button
            key={budget.value}
            type="button"
            className={budgetPreset === budget.value ? "active" : ""}
            onClick={() => setBudgetPreset(budget.value)}
            disabled={disabled}
          >
            {budget.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      {!preview && !error && <p className="muted">选择章节后会显示本次生成将读取的素材。</p>}

      {preview && (
        <>
          <div className="context-summary-grid">
            <span>已选 {preview.included.length}</span>
            <span>强制 {preview.forced.length}</span>
            <span>排除 {preview.excluded.length}</span>
            <span>裁剪 {preview.trimmed.length}</span>
            <span>{preview.estimatedTokens}/{preview.tokenBudget}</span>
          </div>

          <AssetGroup title="已纳入" assets={preview.included} mode="exclude" selectedIds={excludedAssetIds} onToggle={toggleExcluded} />
          <AssetGroup title="可强制加入" assets={preview.available} mode="force" selectedIds={forcedAssetIds} onToggle={toggleForced} />
          <AssetGroup title="被预算裁剪" assets={preview.trimmed} mode="readonly" selectedIds={[]} onToggle={() => undefined} />

          <details className="context-prompt-preview">
            <summary>查看提示词预览</summary>
            <pre>{preview.promptPreview}</pre>
          </details>
        </>
      )}
    </section>
  );
}

function AssetGroup({
  title,
  assets,
  mode,
  selectedIds,
  onToggle
}: {
  title: string;
  assets: ContextAsset[];
  mode: "exclude" | "force" | "readonly";
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="context-asset-group">
      <h5>{title}</h5>
      <ul>
        {assets.slice(0, 8).map((asset) => (
          <li key={asset.id}>
            <div>
              <strong>{asset.name}</strong>
              <span className="muted">{asset.sourceType} · {asset.reason} · {asset.tokenEstimate}</span>
            </div>
            {mode !== "readonly" && !asset.required && (
              <button type="button" className="btn-ghost btn-small" onClick={() => onToggle(asset.id)}>
                {selectedIds.includes(asset.id) ? "撤销" : mode === "exclude" ? "排除" : "加入"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
