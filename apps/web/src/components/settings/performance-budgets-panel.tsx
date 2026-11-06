"use client";

import { useEffect, useMemo, useState } from "react";
import { dollarsToCents } from "./performance-budget-input";

interface BudgetItem {
  id: string;
  scope: "ORGANIZATION" | "PROJECT";
  projectId: string | null;
  warningCents: number | null;
  criticalCents: number | null;
}

interface ProjectItem {
  id: string;
  title: string;
  slug: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface BudgetDraft {
  warningDollars: string;
  criticalDollars: string;
}

const EMPTY_DRAFT: BudgetDraft = { warningDollars: "", criticalDollars: "" };

export function PerformanceBudgetsPanel() {
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [organizationDraft, setOrganizationDraft] = useState<BudgetDraft>(EMPTY_DRAFT);
  const [projectDraft, setProjectDraft] = useState<BudgetDraft>(EMPTY_DRAFT);
  const [projectId, setProjectId] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const organizationBudget = budgets.find((budget) => budget.scope === "ORGANIZATION") ?? null;
  const projectBudgets = budgets.filter((budget) => budget.scope === "PROJECT");
  const projectNameById = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project.title]));
  }, [projects]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [budgetRes, projectRes] = await Promise.all([
        fetch("/api/performance-budgets"),
        fetch("/api/projects")
      ]);
      const budgetJson = (await budgetRes.json()) as ApiEnvelope<BudgetItem[]>;
      const projectJson = (await projectRes.json()) as ApiEnvelope<ProjectItem[]>;
      if (!budgetRes.ok || !budgetJson.success || !budgetJson.data) {
        throw new Error(budgetJson.error ?? `读取预算失败 (${budgetRes.status})`);
      }
      if (!projectRes.ok || !projectJson.success || !projectJson.data) {
        throw new Error(projectJson.error ?? `读取项目失败 (${projectRes.status})`);
      }
      setBudgets(budgetJson.data);
      setProjects(projectJson.data);
      const orgBudget = budgetJson.data.find((budget) => budget.scope === "ORGANIZATION");
      setOrganizationDraft(toDraft(orgBudget ?? null));
      const selectedProjectId = projectId || projectJson.data[0]?.id || "";
      if (!projectId && selectedProjectId) setProjectId(selectedProjectId);
      const selectedProjectBudget = budgetJson.data.find((budget) => budget.projectId === selectedProjectId);
      setProjectDraft(toDraft(selectedProjectBudget ?? null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "读取预算失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // load only on mount; projectId updates should not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveOrganization() {
    await saveBudget({
      scope: "ORGANIZATION",
      draft: organizationDraft,
      onSaved: () => setMessage("组织默认预算已保存")
    });
  }

  async function saveProject() {
    if (!projectId) {
      setError("请先选择项目");
      return;
    }
    await saveBudget({
      scope: "PROJECT",
      projectId,
      draft: projectDraft,
      onSaved: () => {
        const selected = projectNameById.get(projectId) ?? "项目";
        setMessage(`${selected} 的预算覆盖已保存`);
      }
    });
  }

  async function clearOrganization() {
    await clearBudget({
      scope: "ORGANIZATION",
      onCleared: () => {
        setOrganizationDraft(EMPTY_DRAFT);
        setMessage("组织默认预算已清除，趋势告警会恢复系统默认阈值");
      }
    });
  }

  async function clearProject() {
    if (!projectId) {
      setError("请先选择项目");
      return;
    }
    await clearBudget({
      scope: "PROJECT",
      projectId,
      onCleared: () => {
        const selected = projectNameById.get(projectId) ?? "项目";
        setProjectDraft(EMPTY_DRAFT);
        setMessage(`${selected} 已恢复继承组织预算`);
      }
    });
  }

  async function saveBudget(input: {
    scope: "ORGANIZATION" | "PROJECT";
    projectId?: string;
    draft: BudgetDraft;
    onSaved: () => void;
  }) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const warningCents = dollarsToCents(input.draft.warningDollars);
      const criticalCents = dollarsToCents(input.draft.criticalDollars);
      if (warningCents !== null && criticalCents !== null && criticalCents < warningCents) {
        throw new Error("严重阈值不能小于预警阈值");
      }

      const res = await fetch("/api/performance-budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: input.scope,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          warningCents,
          criticalCents
        })
      });
      const json = (await res.json()) as ApiEnvelope<BudgetItem>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `保存预算失败 (${res.status})`);
      }
      input.onSaved();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存预算失败");
    } finally {
      setSaving(false);
    }
  }

  async function clearBudget(input: {
    scope: "ORGANIZATION" | "PROJECT";
    projectId?: string;
    onCleared: () => void;
  }) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance-budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: input.scope,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          clear: true
        })
      });
      const json = (await res.json()) as ApiEnvelope<BudgetItem | null>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `清除预算失败 (${res.status})`);
      }
      input.onCleared();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "清除预算失败");
    } finally {
      setSaving(false);
    }
  }

  function selectProject(id: string) {
    setProjectId(id);
    const existing = projectBudgets.find((budget) => budget.projectId === id);
    setProjectDraft(toDraft(existing ?? null));
  }

  return (
    <section className="settings-card performance-budget-settings">
      <header className="settings-card-header">
        <div>
          <h2>成本预算阈值</h2>
          <p className="muted">阈值按当前趋势窗口计算；项目预算优先于组织默认预算。</p>
        </div>
        <button type="button" className="btn-ghost btn-small" onClick={() => void load()} disabled={isLoading || isSaving}>
          刷新
        </button>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="settings-list-test ok" role="status">{message}</p>}

      {isLoading ? (
        <p className="muted">加载预算中...</p>
      ) : (
        <>
          <BudgetForm
            title="组织默认预算"
            description={organizationBudget ? "所有未单独配置预算的项目会继承这里。" : "尚未配置组织预算；趋势告警使用系统默认阈值。"}
            draft={organizationDraft}
            onChange={setOrganizationDraft}
            onSave={() => void saveOrganization()}
            onClear={() => void clearOrganization()}
            clearLabel="清除预算"
            canClear={organizationBudget !== null}
            isSaving={isSaving}
          />

          <div className="budget-project-form">
            <label>
              <span>项目覆盖</span>
              <select value={projectId} onChange={(event) => selectProject(event.target.value)} disabled={isSaving}>
                <option value="">选择项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
            </label>
            <BudgetForm
              title="项目预算"
              description="保存后，该项目的成本告警会优先使用这里的阈值。"
              draft={projectDraft}
              onChange={setProjectDraft}
              onSave={() => void saveProject()}
              onClear={() => void clearProject()}
              clearLabel="恢复继承"
              canClear={projectBudgets.some((budget) => budget.projectId === projectId)}
              isSaving={isSaving || !projectId}
            />
          </div>

          <ul className="settings-list">
            {projectBudgets.length === 0 ? (
              <li className="settings-list-item">
                <div className="settings-list-main">
                  <div className="settings-list-title">暂无项目覆盖</div>
                  <div className="settings-list-meta">项目会继承组织默认预算。</div>
                </div>
              </li>
            ) : projectBudgets.map((budget) => (
              <li key={budget.id} className="settings-list-item">
                <div className="settings-list-main">
                  <div className="settings-list-title">{projectNameById.get(budget.projectId ?? "") ?? "未命名项目"}</div>
                  <div className="settings-list-meta">
                    <span>预警 {formatCents(budget.warningCents)}</span>
                    <span>严重 {formatCents(budget.criticalCents)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function BudgetForm(props: {
  title: string;
  description: string;
  draft: BudgetDraft;
  onChange: (draft: BudgetDraft) => void;
  onSave: () => void;
  onClear?: () => void;
  clearLabel?: string;
  canClear?: boolean;
  isSaving: boolean;
}) {
  return (
    <div className="settings-form budget-form">
      <div>
        <h3>{props.title}</h3>
        <p className="muted">{props.description}</p>
      </div>
      <div className="budget-form-grid">
        <label>
          <span>预警金额 ($)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            disabled={props.isSaving}
            value={props.draft.warningDollars}
            onChange={(event) => props.onChange({ ...props.draft, warningDollars: event.target.value })}
            placeholder="5.00"
          />
        </label>
        <label>
          <span>严重金额 ($)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            disabled={props.isSaving}
            value={props.draft.criticalDollars}
            onChange={(event) => props.onChange({ ...props.draft, criticalDollars: event.target.value })}
            placeholder="10.00"
          />
        </label>
      </div>
      <div className="settings-form-actions">
        {props.onClear && (
          <button
            type="button"
            className="btn-ghost btn-small"
            onClick={props.onClear}
            disabled={props.isSaving || !props.canClear}
          >
            {props.clearLabel ?? "清除"}
          </button>
        )}
        <button type="button" className="btn-primary btn-small" onClick={props.onSave} disabled={props.isSaving}>
          保存
        </button>
      </div>
    </div>
  );
}

function toDraft(budget: BudgetItem | null): BudgetDraft {
  return {
    warningDollars: budget?.warningCents ? centsToDollars(budget.warningCents) : "",
    criticalDollars: budget?.criticalCents ? centsToDollars(budget.criticalCents) : ""
  };
}



function centsToDollars(value: number): string {
  return (value / 100).toFixed(2);
}

function formatCents(value: number | null): string {
  return value === null ? "-" : `$${(value / 100).toFixed(2)}`;
}
