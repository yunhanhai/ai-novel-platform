"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobSummary } from "./use-workspace-data";

interface ReviewSuggestion {
  issueType: string;
  severity: "info" | "warning" | "error";
  quote: string;
  problem: string;
  suggestion: string;
  replacement?: string;
  verified: boolean;
}

interface ReviewPayload {
  summary: string;
  passed: boolean;
  suggestions: ReviewSuggestion[];
  verifiedCount: number;
  unverifiedCount: number;
  degraded: boolean;
}

interface ReviewPanelProps {
  chapterId: string | null;
  chapterContent: string;
  job: JobSummary | null;
  onRun: () => void;
  isStarting: boolean;
  onApplyReplacement: (quote: string, replacement: string) => boolean;
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  consistency: "前后矛盾",
  world_conflict: "设定冲突",
  foreshadowing: "伏笔",
  timeline: "时间线",
  knowledge_boundary: "认知越界",
  ai_slop: "AI 味",
  pacing: "节奏",
  style_drift: "文风漂移",
  typo: "字词错误"
};

const SEVERITY_LABELS: Record<string, string> = {
  info: "提示",
  warning: "建议",
  error: "必改"
};

export function ReviewPanel({
  chapterId,
  chapterContent,
  job,
  onRun,
  isStarting,
  onApplyReplacement
}: ReviewPanelProps) {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const isRunning = job ? ["QUEUED", "RUNNING"].includes(job.status) : false;
  const isReviewJob = job?.jobType === "REVIEW";

  useEffect(() => {
    if (!isReviewJob) return;
    if (job?.status === "SUCCEEDED") {
      const review = (job.output as { review?: ReviewPayload } | null | undefined)?.review;
      if (review) {
        setPayload(review);
        setNotice(null);
        setApplied(new Set());
      }
    }
    if (job?.status === "FAILED") {
      setNotice(job.errorMessage ?? "审校失败");
    }
  }, [isReviewJob, job?.status, job?.output, job?.errorMessage]);

  const handleApply = useCallback(
    (item: ReviewSuggestion) => {
      if (!item.verified || !item.replacement) return;
      const ok = onApplyReplacement(item.quote, item.replacement);
      if (ok) {
        setApplied((prev) => new Set(prev).add(item.quote));
        setNotice(null);
        // 采纳行为回写 job，作为评审质量的行为信号（评测：应用数/建议总数=采纳率）
        if (job?.id) {
          void fetch(`/api/generation-jobs/${job.id}/feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quote: item.quote })
          }).catch(() => undefined);
        }
      } else {
        setNotice(`无法应用：「${item.quote.slice(0, 16)}…」在当前正文中已不存在，请重新审校。`);
      }
    },
    [onApplyReplacement, job?.id]
  );

  if (!chapterId) {
    return <p className="muted">请先选择一个章节</p>;
  }

  const busy = isStarting || isRunning;

  return (
    <div className="review-panel">
      <div className="review-panel-head">
        <h3>审校</h3>
        <button type="button" className="btn-ghost btn-small" onClick={onRun} disabled={busy}>
          {isStarting && isReviewJob ? "提交中..." : isRunning && isReviewJob ? "审校中..." : "开始审校"}
        </button>
      </div>

      {notice && <p className="form-error">{notice}</p>}

      {!payload && !busy && (
        <p className="muted review-empty">
          让 AI 逐条指出这一章的问题，并给出可直接替换的改法。所有引证都会核对原文，编造的引文不会被采纳。
        </p>
      )}

      {payload && (
        <>
          <div className="review-summary">
            <p className="review-summary-text">{payload.summary}</p>
            <div className="review-summary-meta">
              <span className={`tag ${payload.passed ? "tag-active" : "tag-warning"}`}>
                {payload.passed ? "通过" : "待修改"}
              </span>
              <span className="muted">
                共 {payload.suggestions.length} 条 · 已核对 {payload.verifiedCount} 条
                {payload.unverifiedCount > 0 ? ` · ${payload.unverifiedCount} 条引文未核对` : ""}
              </span>
            </div>
            {payload.degraded && (
              <p className="review-degraded">模型未返回结构化结果，本次审校仅供参考。</p>
            )}
          </div>

          {payload.suggestions.length === 0 ? (
            <p className="muted">没有发现问题。</p>
          ) : (
            <ul className="review-list">
              {payload.suggestions.map((item, index) => {
                const key = `${item.quote}-${index}`;
                const isApplied = applied.has(item.quote);
                const canApply = item.verified && Boolean(item.replacement);
                return (
                  <li key={key} className={`review-item review-severity-${item.severity} ${isApplied ? "review-applied" : ""}`}>
                    <div className="review-item-head">
                      <span className={`tag tag-risk-${item.severity === "error" ? "high" : item.severity === "warning" ? "medium" : "low"}`}>
                        {SEVERITY_LABELS[item.severity] ?? item.severity}
                      </span>
                      <span className="review-issue-type">{ISSUE_TYPE_LABELS[item.issueType] ?? item.issueType}</span>
                      {!item.verified && <span className="tag tag-muted">引文未核对</span>}
                      {isApplied && <span className="tag tag-active">已应用</span>}
                    </div>
                    <blockquote className="review-quote">{item.quote}</blockquote>
                    <p className="review-problem">{item.problem}</p>
                    {item.suggestion && <p className="review-suggestion">建议：{item.suggestion}</p>}
                    {canApply && (
                      <div className="review-replacement">
                        <span className="muted">替换为</span>
                        <p>{item.replacement}</p>
                      </div>
                    )}
                    <div className="review-item-actions">
                      <button
                        type="button"
                        className="btn-ghost btn-small"
                        onClick={() => handleApply(item)}
                        disabled={!canApply || isApplied || chapterContent.length === 0}
                        title={
                          !item.verified
                            ? "引文未在正文中核对到，不能自动替换"
                            : !item.replacement
                              ? "该问题没有给出可直接替换的文本"
                              : undefined
                        }
                      >
                        {isApplied ? "已应用" : "应用替换"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
