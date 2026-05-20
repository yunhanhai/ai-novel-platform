"use client";

import { useCallback, useState } from "react";
import { AiDraftDialog, type FieldSpec } from "./ai-draft-dialog";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface DeslopIssue {
  category: string;
  severity: "info" | "warning" | "error";
  matched: string;
  position: { start: number; end: number };
  suggestion: string;
}

interface DeslopStats {
  totalChars: number;
  totalWords: number;
  sentenceCount: number;
  estimatedTokens: number;
  avgSentenceLength: number;
}

interface ScanReport {
  issues: DeslopIssue[];
  stats: DeslopStats;
  appliedRuleCount: number;
}

interface DeslopRule {
  id: string;
  ruleType: string;
  pattern: string;
  category: string;
  severity: string;
  suggestion: string | null;
  isActive: boolean;
}

interface DeslopRuleDraft extends Record<string, unknown> {
  pattern: string;
  category: string;
  severity: string;
  suggestion: string;
  ruleType: string;
}

const RULE_CATEGORY_OPTIONS = [
  { value: "stock_phrase", label: "套话" },
  { value: "weak_adverb", label: "弱化副词" },
  { value: "abstract_noun_triple", label: "抽象名词" },
  { value: "repetition", label: "重复" },
  { value: "sentence_pattern", label: "句式" },
  { value: "custom", label: "自定义" }
];

const RULE_SEVERITY_OPTIONS = [
  { value: "info", label: "提示" },
  { value: "warning", label: "警告" },
  { value: "error", label: "错误" }
];

const RULE_DRAFT_FIELDS: ReadonlyArray<FieldSpec<DeslopRuleDraft>> = [
  { key: "pattern", label: "匹配词/短语", control: "input" },
  { key: "category", label: "分类", control: "select", options: RULE_CATEGORY_OPTIONS },
  { key: "severity", label: "严重度", control: "select", options: RULE_SEVERITY_OPTIONS },
  { key: "suggestion", label: "建议", control: "textarea", rows: 2 }
];

function applyReplacement(originalText: string, issue: DeslopIssue): string {
  const { start, end } = issue.position;
  // suggestion 非空 → 替换；为空 → 删除
  const replacement = issue.suggestion || "";
  return originalText.slice(0, start) + replacement + originalText.slice(end);
}

interface Props {
  projectId: string | null;
  currentText: string;
  chapterId?: string | null;
  onApplied?: () => void;
}

export function DeslopPanel({ projectId, currentText, chapterId, onApplied }: Props) {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rules, setRules] = useState<DeslopRule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);

  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("stock_phrase");
  const [severity, setSeverity] = useState<"info" | "warning" | "error">("warning");
  const [suggestion, setSuggestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const reloadRules = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/deslop-rules?projectId=${encodeURIComponent(projectId)}`);
      const json = (await res.json()) as ApiEnvelope<DeslopRule[]>;
      if (json.success) {
        setRules(json.data ?? []);
        setRulesLoaded(true);
      }
    } catch {
      /* 忽略 */
    }
  }, [projectId]);

  async function handleScan() {
    if (!projectId || !currentText.trim()) {
      setError("当前章节正文为空，无法扫描");
      return;
    }
    setScanning(true);
    setError(null);
    if (!rulesLoaded) await reloadRules();
    try {
      const res = await fetch("/api/deslop-rules/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, text: currentText })
      });
      const json = (await res.json()) as ApiEnvelope<ScanReport>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `扫描失败 (${res.status})`);
      }
      setReport(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setScanning(false);
    }
  }

  async function handleAddRule(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !pattern.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/deslop-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          ruleType: "exact_match",
          pattern: pattern.trim(),
          category,
          severity,
          suggestion: suggestion.trim() || undefined
        })
      });
      const json = (await res.json()) as ApiEnvelope<DeslopRule>;
      if (!res.ok || !json.success) throw new Error(json.error ?? "创建失败");
      setPattern("");
      setSuggestion("");
      await reloadRules();
      setShowRuleForm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApply(idx: number, issue: DeslopIssue) {
    if (!chapterId || !currentText) return;
    setApplyingIdx(idx);
    setApplyError(null);
    try {
      const newText = applyReplacement(currentText, issue);
      // 1. 先快照当前正文为 content version
      await fetch("/api/content-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId, content: currentText, source: "MANUAL" })
      });
      // 2. 更新章节正文
      const res = await fetch(`/api/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newText })
      });
      if (!res.ok) throw new Error("更新失败");
      onApplied?.();
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : "应用失败");
    } finally {
      setApplyingIdx(null);
    }
  }

  async function handleToggleRule(rule: DeslopRule) {
    await fetch(`/api/deslop-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive })
    });
    await reloadRules();
  }

  if (!projectId) return <p className="muted">请先选择一个项目</p>;

  const groupedIssues = report ? groupBySeverity(report.issues) : null;

  return (
    <div className="resource-panel">
      <div className="memories-filters">
        <h3>去 AI 味扫描</h3>
        <div className="memories-filter-buttons">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleScan()}
            disabled={scanning || !currentText.trim()}
          >
            {scanning ? "扫描中..." : "扫描当前章节"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setShowRuleForm((v) => !v);
              if (!rulesLoaded) void reloadRules();
            }}
          >
            {showRuleForm ? "收起规则" : "管理规则"}
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {applyError && <p className="form-error">{applyError}</p>}
      {!currentText.trim() && <p className="muted">编辑器内尚无正文</p>}

      {report && (
        <>
          <DeslopStatsView stats={report.stats} issueCount={report.issues.length} ruleCount={report.appliedRuleCount} />

          {report.issues.length === 0 ? (
            <p className="muted">未发现问题。继续保持。</p>
          ) : (
            <div className="deslop-issues">
              {(["error", "warning", "info"] as const).map((sev) => {
                const list = groupedIssues?.[sev] ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={sev} className={`deslop-issue-group deslop-issue-${sev}`}>
                    <h4>{labelOfSeverity(sev)} ({list.length})</h4>
                    <ul>
                      {list.map((issue, idx) => (
                        <li key={`${sev}-${idx}`}>
                          <span className="tag tag-method">{labelOfCategory(issue.category)}</span>
                          <code>{issue.matched}</code>
                          <span className="muted deslop-issue-suggestion">{issue.suggestion}</span>
                          <span className="muted">@ {issue.position.start}</span>
                          {chapterId && (
                            <button
                              type="button"
                              className="btn-ghost btn-small"
                              disabled={applyingIdx !== null}
                              onClick={() => void handleApply(idx, issue)}
                            >
                              {applyingIdx === idx ? "应用..." : "应用"}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showRuleForm && (
        <div className="deslop-rules-section">
          <div className="resource-panel-header">
            <h4 style={{ margin: 0 }}>项目自定义规则 ({rules.length})</h4>
            <button type="button" className="btn-primary btn-small" onClick={() => setAiOpen(true)}>
              ✨ AI 帮我生成规则
            </button>
          </div>
          <form className="resource-form" onSubmit={handleAddRule}>
            <label>
              <span>词/短语 *</span>
              <input value={pattern} onChange={(e) => setPattern(e.target.value)} required maxLength={200} placeholder="例如：仿佛一切" />
            </label>
            <label>
              <span>分类</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="stock_phrase">套话</option>
                <option value="weak_adverb">弱化副词</option>
                <option value="abstract_noun_triple">抽象名词</option>
                <option value="repetition">重复</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <label>
              <span>严重度</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="info">提示</option>
                <option value="warning">警告</option>
                <option value="error">错误</option>
              </select>
            </label>
            <label>
              <span>建议替换 / 说明</span>
              <input value={suggestion} onChange={(e) => setSuggestion(e.target.value)} placeholder="例如：删除该套话" />
            </label>
            <button type="submit" className="btn-primary" disabled={submitting || !pattern.trim()}>
              {submitting ? "添加中" : "添加规则"}
            </button>
          </form>

          <ul className="resource-cards">
            {rules.map((r) => (
              <li key={r.id} className={`resource-card ${r.isActive ? "" : "inactive"}`}>
                <div className="resource-card-header">
                  <code>{r.pattern}</code>
                  <span className={`tag tag-method`}>{labelOfCategory(r.category)}</span>
                </div>
                {r.suggestion && <p className="muted resource-card-meta">{r.suggestion}</p>}
                <div className="resource-card-actions">
                  <button type="button" className="btn-ghost" onClick={() => void handleToggleRule(r)}>
                    {r.isActive ? "停用" : "启用"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AiDraftDialog<DeslopRuleDraft, { projectId: string; existingPatterns: string[] }>
        open={aiOpen}
        title="AI 帮我生成去 AI 味规则"
        endpoint="/api/asset-drafts/deslop-rules"
        fields={RULE_DRAFT_FIELDS}
        titleField="pattern"
        extraPayload={{
          projectId,
          existingPatterns: rules.map((r) => r.pattern)
        }}
        onAdopt={async (draft) => {
          const res = await fetch("/api/deslop-rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              ruleType: draft.ruleType || "exact_match",
              pattern: draft.pattern,
              category: draft.category,
              severity: draft.severity,
              suggestion: draft.suggestion || undefined
            })
          });
          const json = (await res.json()) as ApiEnvelope<DeslopRule>;
          if (!res.ok || !json.success) throw new Error(json.error ?? "添加失败");
          await reloadRules();
        }}
        onClose={() => setAiOpen(false)}
      />
    </div>
  );
}

function DeslopStatsView({
  stats,
  issueCount,
  ruleCount
}: {
  stats: DeslopStats;
  issueCount: number;
  ruleCount: number;
}) {
  return (
    <div className="deslop-stats">
      <div className="stat-item">
        <span className="muted">字数</span>
        <strong>{stats.totalWords.toLocaleString()}</strong>
      </div>
      <div className="stat-item">
        <span className="muted">句数</span>
        <strong>{stats.sentenceCount}</strong>
      </div>
      <div className="stat-item">
        <span className="muted">平均句长</span>
        <strong>{stats.avgSentenceLength}</strong>
      </div>
      <div className="stat-item">
        <span className="muted">问题数</span>
        <strong className={issueCount === 0 ? "stat-good" : "stat-warn"}>{issueCount}</strong>
      </div>
      <div className="stat-item">
        <span className="muted">自定义规则</span>
        <strong>{ruleCount}</strong>
      </div>
    </div>
  );
}

function groupBySeverity(issues: DeslopIssue[]) {
  return issues.reduce(
    (acc, issue) => {
      acc[issue.severity].push(issue);
      return acc;
    },
    { error: [] as DeslopIssue[], warning: [] as DeslopIssue[], info: [] as DeslopIssue[] }
  );
}

function labelOfSeverity(s: string): string {
  return s === "error" ? "错误" : s === "warning" ? "警告" : "提示";
}

function labelOfCategory(c: string): string {
  const map: Record<string, string> = {
    weak_adverb: "弱化副词",
    summary_sentence: "过度总结",
    abstract_noun_triple: "抽象名词",
    stock_phrase: "套话",
    repetition: "重复",
    custom: "自定义",
    sentence_pattern: "句式"
  };
  return map[c] ?? c;
}
