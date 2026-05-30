"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

interface BudgetPolicyDto {
  id: string;
  projectId: string | null;
  monthlyBudgetCents: number;
  monthlyTokenQuota: number;
  cycleAnchorDay: number;
  thresholdPercents: number[];
}

interface BudgetNotificationDto {
  id: string;
  thresholdPercent: number;
  actualCostCents: number;
  budgetCents: number;
  actualTokens: number;
  tokenQuota: number;
  status: string;
  message: string | null;
  createdAt: string;
}

interface BudgetDashboard {
  policy: BudgetPolicyDto | null;
  period: {
    periodStart: string;
    periodEnd: string;
    periodEndExclusive: string;
  };
  summary: {
    actualCostCents: number;
    budgetCents: number;
    remainingBudgetCents: number | null;
    costUsagePercent: number | null;
    actualTokens: number;
    tokenQuota: number;
    remainingTokens: number | null;
    tokenUsagePercent: number | null;
    maxUsagePercent: number;
  };
  dailyUsage: Array<{ date: string; costCents: number; tokens: number }>;
  notifications: BudgetNotificationDto[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FormState {
  projectId: string;
  monthlyBudgetYuan: string;
  monthlyTokenQuota: string;
  cycleAnchorDay: string;
  thresholdPercents: string;
}

const DEFAULT_FORM: FormState = {
  projectId: "",
  monthlyBudgetYuan: "300",
  monthlyTokenQuota: "1000000",
  cycleAnchorDay: "1",
  thresholdPercents: "50,80,100"
};

export function BudgetGovernancePanel() {
  const [dashboard, setDashboard] = useState<BudgetDashboard | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadDashboard() {
    setError(null);
    try {
      const res = await fetch("/api/settings/budget");
      const json = (await res.json()) as ApiResponse<BudgetDashboard>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `读取失败 (${res.status})`);
      }
      setDashboard(json.data);
      setForm(formFromDashboard(json.data));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const maxDailyCost = useMemo(() => {
    if (!dashboard) return 1;
    return Math.max(1, ...dashboard.dailyUsage.map((point) => point.costCents));
  }, [dashboard]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = formToPayload(form);
      const res = await fetch("/api/settings/budget", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = (await res.json()) as ApiResponse<{ dashboard: BudgetDashboard }>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `保存失败 (${res.status})`);
      }
      setDashboard(json.data.dashboard);
      setForm(formFromDashboard(json.data.dashboard));
      setNotice("预算策略已保存，当前周期用量已刷新。");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleAcknowledge(id: string) {
    setAcknowledgingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/budget-notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const json = (await res.json()) as ApiResponse<BudgetNotificationDto>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `处理失败 (${res.status})`);
      }
      await loadDashboard();
      setNotice("通知已标记为已处理。");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "处理失败");
    } finally {
      setAcknowledgingId(null);
    }
  }

  if (loading) {
    return (
      <section className="settings-card budget-card">
        <p className="muted">正在读取预算与用量...</p>
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className="settings-card budget-card">
        {error && <p className="form-error">{error}</p>}
        <button type="button" className="btn-primary btn-small" onClick={() => void loadDashboard()}>
          重试
        </button>
      </section>
    );
  }

  const usageWidth = `${Math.min(100, dashboard.summary.maxUsagePercent)}%`;

  return (
    <div className="budget-governance">
      <section className="settings-card budget-card budget-hero-card">
        <div className="budget-card-header">
          <div>
            <h2>当前周期</h2>
            <p className="muted">
              {formatDate(dashboard.period.periodStart)} 至 {formatDate(dashboard.period.periodEnd)}
            </p>
          </div>
          <span className={dashboard.summary.maxUsagePercent >= 100 ? "budget-state over" : "budget-state"}>
            使用率 {formatPercent(dashboard.summary.maxUsagePercent)}
          </span>
        </div>

        <div
          className="budget-meter"
          role="img"
          aria-label={`预算使用率 ${formatPercent(dashboard.summary.maxUsagePercent)}`}
        >
          <div className="budget-meter-track">
            <span className="budget-meter-fill" style={{ width: usageWidth }} />
          </div>
          <div className="budget-meter-labels">
            <span>0%</span>
            <span>80%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="budget-kpi-grid">
          <Metric label="费用" value={formatCents(dashboard.summary.actualCostCents)} detail={`额度 ${formatCents(dashboard.summary.budgetCents)}`} />
          <Metric label="费用使用率" value={formatNullablePercent(dashboard.summary.costUsagePercent)} detail={remainingBudgetText(dashboard.summary.remainingBudgetCents)} />
          <Metric label="Token" value={formatNumber(dashboard.summary.actualTokens)} detail={`额度 ${formatNumber(dashboard.summary.tokenQuota)}`} />
          <Metric label="Token 使用率" value={formatNullablePercent(dashboard.summary.tokenUsagePercent)} detail={remainingTokenText(dashboard.summary.remainingTokens)} />
        </div>
      </section>

      <section className="settings-card budget-card">
        <div className="settings-card-header">
          <h2>预算策略</h2>
          {dashboard.policy ? <span className="badge">已启用</span> : <span className="badge muted-badge">未配置</span>}
        </div>
        <form className="settings-form budget-policy-form" onSubmit={handleSubmit}>
          <label className="budget-field" htmlFor="budget-project-id">
            <span>项目 ID（可选）</span>
            <input
              id="budget-project-id"
              value={form.projectId}
              onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}
              placeholder="留空表示组织级预算"
            />
          </label>
          <label className="budget-field" htmlFor="budget-monthly-cents">
            <span>月度费用额度（元）</span>
            <input
              id="budget-monthly-cents"
              inputMode="decimal"
              value={form.monthlyBudgetYuan}
              onChange={(event) => setForm((prev) => ({ ...prev, monthlyBudgetYuan: event.target.value }))}
            />
          </label>
          <label className="budget-field" htmlFor="budget-token-quota">
            <span>月度 Token 额度</span>
            <input
              id="budget-token-quota"
              inputMode="numeric"
              value={form.monthlyTokenQuota}
              onChange={(event) => setForm((prev) => ({ ...prev, monthlyTokenQuota: event.target.value }))}
            />
          </label>
          <label className="budget-field" htmlFor="budget-cycle-anchor">
            <span>周期起始日</span>
            <input
              id="budget-cycle-anchor"
              inputMode="numeric"
              value={form.cycleAnchorDay}
              onChange={(event) => setForm((prev) => ({ ...prev, cycleAnchorDay: event.target.value }))}
            />
          </label>
          <label className="budget-field budget-field-wide" htmlFor="budget-thresholds">
            <span>通知阈值（%）</span>
            <input
              id="budget-thresholds"
              value={form.thresholdPercents}
              onChange={(event) => setForm((prev) => ({ ...prev, thresholdPercents: event.target.value }))}
            />
          </label>
          <p className="form-hint budget-field-wide">周期起始日限制为 1-28，阈值以英文逗号分隔。</p>
          <div className="settings-form-actions budget-field-wide">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "保存中..." : "保存预算策略"}
            </button>
          </div>
        </form>
        {error && <p className="form-error">{error}</p>}
        {notice && <p className="budget-inline-success">{notice}</p>}
      </section>

      <section className="settings-card budget-card">
        <div className="settings-card-header">
          <h2>费用趋势</h2>
          <span className="muted">每日估算成本</span>
        </div>
        <ul className="budget-bar-list" aria-label="每日预算使用明细">
          {dashboard.dailyUsage.map((point) => (
            <li key={point.date}>
              <span className="budget-bar-date">{point.date.slice(5)}</span>
              <span className="budget-bar-track" aria-hidden="true">
                <span style={{ width: `${Math.max(2, Math.round((point.costCents / maxDailyCost) * 100))}%` }} />
              </span>
              <span className="budget-bar-value">{formatCents(point.costCents)}</span>
            </li>
          ))}
        </ul>
        <details className="budget-usage-table">
          <summary>查看每日明细表</summary>
          <table>
            <thead>
              <tr><th>日期</th><th>费用</th><th>Token</th></tr>
            </thead>
            <tbody>
              {dashboard.dailyUsage.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td>{formatCents(point.costCents)}</td>
                  <td>{formatNumber(point.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="settings-card budget-card">
        <div className="settings-card-header">
          <h2>超预算通知</h2>
          <span className="muted">保留本周期触发记录</span>
        </div>
        {dashboard.notifications.length === 0 ? (
          <div className="empty-state"><p>当前没有待处理的预算通知。</p></div>
        ) : (
          <ul className="budget-notification-list">
            {dashboard.notifications.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.thresholdPercent}% 阈值</strong>
                  <p>{item.message ?? "预算阈值已触发，请检查本周期用量。"}</p>
                  <span>{formatDateTime(item.createdAt)} · {item.status === "open" ? "待处理" : "已处理"}</span>
                </div>
                {item.status === "open" && (
                  <button
                    type="button"
                    className="btn-ghost btn-small"
                    disabled={acknowledgingId === item.id}
                    onClick={() => void handleAcknowledge(item.id)}
                  >
                    {acknowledgingId === item.id ? "处理中..." : "标记已处理"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="budget-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function formFromDashboard(dashboard: BudgetDashboard): FormState {
  const policy = dashboard.policy;
  if (!policy) return DEFAULT_FORM;
  return {
    projectId: policy.projectId ?? "",
    monthlyBudgetYuan: centsToInput(policy.monthlyBudgetCents),
    monthlyTokenQuota: String(policy.monthlyTokenQuota),
    cycleAnchorDay: String(policy.cycleAnchorDay),
    thresholdPercents: policy.thresholdPercents.join(",")
  };
}

function formToPayload(form: FormState) {
  const budgetYuan = Number(form.monthlyBudgetYuan);
  const tokenQuota = Number(form.monthlyTokenQuota);
  const cycleAnchorDay = Number(form.cycleAnchorDay);
  if (!Number.isFinite(budgetYuan) || budgetYuan < 0) throw new Error("月度费用额度必须是非负数字");
  if (!Number.isInteger(tokenQuota) || tokenQuota < 0) throw new Error("月度 Token 额度必须是非负整数");
  if (!Number.isInteger(cycleAnchorDay) || cycleAnchorDay < 1 || cycleAnchorDay > 28) {
    throw new Error("周期起始日必须是 1-28 的整数");
  }

  return {
    projectId: form.projectId.trim() || null,
    monthlyBudgetCents: Math.round(budgetYuan * 100),
    monthlyTokenQuota: tokenQuota,
    cycleAnchorDay,
    thresholdPercents: form.thresholdPercents
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item))
  };
}

function centsToInput(value: number): string {
  return (value / 100).toFixed(2).replace(/\.00$/, "");
}

function formatCents(value: number): string {
  return `¥${(value / 100).toFixed(2)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "未设置" : formatPercent(value);
}

function remainingBudgetText(value: number | null): string {
  return value === null ? "未设置费用额度" : `剩余 ${formatCents(value)}`;
}

function remainingTokenText(value: number | null): string {
  return value === null ? "未设置 Token 额度" : `剩余 ${formatNumber(value)}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
