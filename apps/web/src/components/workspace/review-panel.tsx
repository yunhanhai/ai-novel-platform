"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export interface ReviewSource { chapterId: string; content: string }
interface ReviewPanelProps {
  chapterId: string | null;
  chapterContent: string;
  job: JobSummary | null;
  onRun: () => void;
  isStarting: boolean;
  runNotice?: string | null;
  onApplyReplacement: (quote: string, replacement: string, source: ReviewSource) => boolean;
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
  onApplyReplacement,
  runNotice
}: ReviewPanelProps) {
  const [snapshot, setSnapshot] = useState<{ payload: ReviewPayload; source: ReviewSource; sourceSha256: string; jobId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sourceRef = useRef({ chapterId, content: chapterContent });
  sourceRef.current = { chapterId, content: chapterContent };
  const applying = useRef(false);
  const payload = snapshot?.payload;

  const isRunning = job ? ["QUEUED", "RUNNING"].includes(job.status) : false;
  const isReviewJob = job?.jobType === "REVIEW";

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    if (!isReviewJob || !job || !chapterId) return;
    if (["QUEUED", "RUNNING"].includes(job.status)) setNotice(null);
    if (["FAILED", "CANCELLED"].includes(job.status)) setNotice(job.errorMessage ?? (job.status === "CANCELLED" ? "审校已取消" : "审校失败"));
    if (job.status === "SUCCEEDED") {
      const output = job.output;
      if (!output?.review || output.chapterId !== chapterId || !output.sourceSha256 || !/^[a-f0-9]{64}$/i.test(output.sourceSha256)) {
        setNotice("审校结果来源无法核对，请重新审校。");
      } else {
        const source: ReviewSource = { chapterId, content: chapterContent };
        void crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.content)).then(digest => {
          if (!active || sourceRef.current.chapterId !== source.chapterId || sourceRef.current.content !== source.content) return;
          const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
          if (hash !== output.sourceSha256!.toLowerCase()) { setNotice("正文已变化，请重新审校。"); return; }
          setSnapshot({ payload: output.review!, source, sourceSha256: hash, jobId: job.id }); setNotice(null);
        }).catch(() => { if (active) setNotice("无法核对审校来源，请重新审校。"); });
      }
    }
    return () => { active = false; };
  }, [isReviewJob, job?.id, job?.status, job?.output, job?.errorMessage, chapterId, chapterContent]);

  const handleApply = useCallback(
    (item: ReviewSuggestion, suggestionIndex: number) => {
      if (!snapshot || snapshot.payload.suggestions[suggestionIndex] !== item || applying.current || !item.verified || !item.replacement) return;
      const source = snapshot.source;
      const index = source.content.indexOf(item.quote);
      if (sourceRef.current.chapterId !== source.chapterId || sourceRef.current.content !== source.content || !item.quote || index < 0 || source.content.indexOf(item.quote, index + 1) !== -1) {
        setSnapshot(null); setNotice("正文或引用位置无法核对，请重新审校。"); return;
      }
      applying.current = true;
      const ok = onApplyReplacement(item.quote, item.replacement, source);
      applying.current = false;
      if (ok) {
        setSnapshot(null); setNotice("已应用到编辑器；其余建议请基于新稿重新审校。");
        // Editor adoption is a behavioral signal, separate from a saved-prose receipt.
        if (snapshot.jobId) {
          void fetch(`/api/generation-jobs/${snapshot.jobId}/feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chapterId: source.chapterId, sourceSha256: snapshot.sourceSha256, suggestionIndex, quote: item.quote, replacement: item.replacement })
          }).catch(() => undefined);
        }
      } else {
        setNotice(`无法应用：「${item.quote.slice(0, 16)}…」在当前正文中已不存在，请重新审校。`);
      }
    },
    [onApplyReplacement, snapshot]
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

      {(runNotice || notice) && <p className="form-error">{runNotice || notice}</p>}

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
                const quoteStart = snapshot!.source.content.indexOf(item.quote);
                const unique = item.quote.length > 0 && quoteStart >= 0 && snapshot!.source.content.indexOf(item.quote, quoteStart + 1) === -1;
                const canApply = item.verified && unique && Boolean(item.replacement);
                return (
                  <li key={key} className={`review-item review-severity-${item.severity}`}>
                    <div className="review-item-head">
                      <span className={`tag tag-risk-${item.severity === "error" ? "high" : item.severity === "warning" ? "medium" : "low"}`}>
                        {SEVERITY_LABELS[item.severity] ?? item.severity}
                      </span>
                      <span className="review-issue-type">{ISSUE_TYPE_LABELS[item.issueType] ?? item.issueType}</span>
                      {!item.verified && <span className="tag tag-muted">引文未核对</span>}
                      {item.verified && !unique && <span className="tag tag-muted">引用无法唯一定位，仅供参考</span>}
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
                        onClick={() => handleApply(item, index)}
                        disabled={!canApply || chapterContent.length === 0}
                        title={
                          !item.verified
                            ? "引文未在正文中核对到，不能自动替换"
                            : !item.replacement
                              ? "该问题没有给出可直接替换的文本"
                              : undefined
                        }
                      >
                        应用替换
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
