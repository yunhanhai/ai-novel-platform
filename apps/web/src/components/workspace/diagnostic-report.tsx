"use client";

import { useEffect, useRef, useState } from "react";
import type { DiagnosticSummaryView, JobSummary } from "./use-workspace-data";
import { labelForAbandonRisk } from "../../lib/display-labels";

export const DIAGNOSTIC_JOB_TYPES = new Set(["DIAGNOSE_CHAPTER", "READER_SIMULATION", "STYLE_DRIFT_CHECK", "CONTINUITY_CHECK"]);

function validSummary(value: DiagnosticSummaryView): boolean {
  return [value.readerScore, value.hookStrength, value.pacingScore, value.styleDrift].every(score => Number.isInteger(score) && score >= 0 && score <= 100) &&
    ["low", "medium", "high"].includes(value.abandonRisk) && Array.isArray(value.suggestions) && value.suggestions.every(item => typeof item === "string" && item.trim()) &&
    Array.isArray(value.continuityIssues) && value.continuityIssues.every(item => item && ["info", "warning", "error"].includes(item.severity) && typeof item.detail === "string" && item.detail.trim() && typeof item.suggestion === "string" && item.suggestion.trim());
}

interface Props { job: JobSummary; chapterId: string | null; currentContent: string }

export function DiagnosticReport({ job, chapterId, currentContent }: Props) {
  const current = useRef({ job, chapterId, currentContent });
  current.current = { job, chapterId, currentContent };
  const [accepted, setAccepted] = useState<{ jobId: string; output: JobSummary["output"]; chapterId: string; content: string; summary: DiagnosticSummaryView } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAccepted(null); setNotice(null);
    if (!DIAGNOSTIC_JOB_TYPES.has(job.jobType) || job.status !== "SUCCEEDED") return;
    const output = job.output;
    if (!chapterId || output?.chapterId !== chapterId || output.diagnosticType !== job.jobType || output.diagnosticDegraded || !output.diagnosticSummary || !validSummary(output.diagnosticSummary) || typeof output.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(output.sourceSha256)) {
      setNotice("诊断来源或结果无法核对，请对当前章节重新诊断。"); return;
    }
    const summary = output.diagnosticSummary;
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(currentContent)).then(digest => {
      if (!active || current.current.job !== job || current.current.chapterId !== chapterId || current.current.currentContent !== currentContent) return;
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== output.sourceSha256!.toLowerCase()) { setNotice("正文已变化，请重新诊断。"); return; }
      setAccepted({ jobId: job.id, output, chapterId, content: currentContent, summary });
    }).catch(() => { if (active) setNotice("无法核对诊断来源，请重新诊断。"); });
    return () => { active = false; };
  }, [job, chapterId, currentContent]);

  if (!DIAGNOSTIC_JOB_TYPES.has(job.jobType) || job.status !== "SUCCEEDED") return null;
  const summary = accepted && accepted.jobId === job.id && accepted.output === job.output && accepted.chapterId === chapterId && accepted.content === currentContent ? accepted.summary : null;
  if (!summary) return notice ? <p className="muted" role="status" aria-label="诊断来源提示">{notice}</p> : null;
  return (
    <section className="diagnostic-summary" aria-label="质量诊断结果">
      <div className="diagnostic-summary-head">
        <strong>质量诊断</strong>
        <span className={`tag tag-risk tag-risk-${summary.abandonRisk}`}>弃书风险 {labelForAbandonRisk(summary.abandonRisk)}</span>
      </div>
      <div className="diagnostic-scores muted">
        <span>读者评分 {summary.readerScore}</span>
        <span>钩子 {summary.hookStrength}</span>
        <span>节奏 {summary.pacingScore}</span>
        <span>风格漂移 {summary.styleDrift}（越低越好）</span>
      </div>
      <p className="muted">评分仅供审阅参考，不代表真实读者测量；后续改文请重新诊断。</p>
      {summary.suggestions && summary.suggestions.length > 0 && <ul className="diagnostic-suggestions">{summary.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul>}
      {summary.continuityIssues && summary.continuityIssues.length > 0 && (
        <ul className="diagnostic-issues">{summary.continuityIssues.map((issue, index) => (
          <li key={index} className={`diagnostic-issue diagnostic-issue-${issue.severity}`}><span className="diagnostic-issue-detail">{issue.detail}</span><span className="muted"> → {issue.suggestion}</span></li>
        ))}</ul>
      )}
    </section>
  );
}
