"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecoveryAuditItem, RecoveryAuditList } from "../../server/recovery-audit";
import {
  formatRecoveryAuditTime,
  getRecoveryActionDisplay,
  getRecoveryActorLabel,
  getRecoveryMetadataSummary,
  isRecoveryAuditEmpty
} from "./recovery-audit-list-model";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Props {
  enabled: boolean;
}

export function RecoveryAuditList({ enabled }: Props) {
  const [data, setData] = useState<RecoveryAuditList | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audit-logs/recovery-actions?limit=10");
      const json = (await res.json()) as ApiEnvelope<RecoveryAuditList>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `加载恢复记录失败 (${res.status})`);
      }
      setData(json.data);
    } catch (err: unknown) {
      setData(null);
      setError(err instanceof Error ? err.message : "加载恢复记录失败");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!enabled) {
        if (active) setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/audit-logs/recovery-actions?limit=10");
        const json = (await res.json()) as ApiEnvelope<RecoveryAuditList>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error ?? `加载恢复记录失败 (${res.status})`);
        }
        if (active) setData(json.data);
      } catch (err: unknown) {
        if (active) {
          setData(null);
          setError(err instanceof Error ? err.message : "加载恢复记录失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [enabled]);

  return (
    <section className="performance-section recovery-audit-section" aria-label="恢复记录">
      <div className="performance-section-heading">
        <div>
          <h4>恢复记录</h4>
          <span className="muted">最近 10 条人工恢复动作</span>
        </div>
        <button type="button" className="btn-ghost btn-small" onClick={() => void load()} disabled={!enabled || isLoading}>
          {isLoading ? "刷新中" : "刷新"}
        </button>
      </div>

      {!enabled && <p className="performance-empty muted">配置默认组织后可查看恢复记录。</p>}

      {enabled && isLoading && !data && (
        <div className="performance-skeleton recovery-audit-skeleton" aria-label="恢复记录加载中">
          <div />
          <div />
          <div />
        </div>
      )}

      {enabled && error && (
        <div className="performance-error recovery-audit-error">
          <p className="form-error">{error}</p>
        </div>
      )}

      {isRecoveryAuditEmpty(data) && !isLoading && !error && (
        <p className="performance-empty muted">暂无恢复操作记录。</p>
      )}

      {data && data.items.length > 0 && !error && (
        <ol className="recovery-audit-list">
          {data.items.map((item) => (
            <RecoveryAuditRow key={item.id} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

function RecoveryAuditRow({ item }: { item: RecoveryAuditItem }) {
  const action = getRecoveryActionDisplay(item.action);
  return (
    <li className="recovery-audit-row">
      <div className="recovery-audit-main">
        <strong>{action.label}</strong>
        <span className="muted">{getRecoveryMetadataSummary(item)}</span>
      </div>
      <span className={`recovery-audit-action recovery-audit-${action.tone}`}>{action.label}</span>
      <span className="muted recovery-audit-actor">{getRecoveryActorLabel(item)}</span>
      <span className="muted recovery-audit-target">{item.entityId ?? item.entityType}</span>
      <span className="muted recovery-audit-time">{formatRecoveryAuditTime(item.createdAt)}</span>
    </li>
  );
}
