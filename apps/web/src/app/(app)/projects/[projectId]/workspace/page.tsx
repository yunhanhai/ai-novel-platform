"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";
import { useParams } from "next/navigation";
import { AssetSidebar } from "../../../../../components/workspace/asset-sidebar";
import { EditorPane, type EditorSelection } from "../../../../../components/workspace/editor-pane";
import { WorkspaceSideTabs } from "../../../../../components/workspace/workspace-side-tabs";
import {
  useChapters,
  useChapterContent,
  useJobPolling
} from "../../../../../components/workspace/use-workspace-data";

const REWRITE_POLISH_JOB_TYPES = new Set(["REWRITE", "POLISH"]);

interface RewriteResult {
  jobId: string;
  mode: string;
  selectedText: string;
  newText: string;
  start: number;
  end: number;
}

export default function WorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? null;

  const { chapters, isLoading: chaptersLoading, createChapter, reload: reloadChapters } = useChapters(projectId);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeChapterId && chapters.length > 0) {
      setActiveChapterId(chapters[0]!.id);
    }
  }, [chapters, activeChapterId]);

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);
  const { content, setContent, saveStatus, isLoadingContent, flush, reload: reloadContent } =
    useChapterContent(activeChapterId);
  const { job, startJob, isStarting, error: jobError } = useJobPolling();

  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(null);
  const [rewriteNotice, setRewriteNotice] = useState<string | null>(null);
  const selectionRef = useRef<EditorSelection | null>(null);
  selectionRef.current = selection;

  useEffect(() => {
    if (job?.status === "SUCCEEDED" && !REWRITE_POLISH_JOB_TYPES.has(job.jobType)) {
      void reloadChapters();
      void reloadContent();
    }
  }, [job?.status, job?.jobType, reloadChapters, reloadContent]);

  useEffect(() => {
    if (job?.status === "SUCCEEDED" && REWRITE_POLISH_JOB_TYPES.has(job.jobType)) {
      const sel = selectionRef.current;
      const out = job.output;
      if (sel && out?.newText && out.selectedText) {
        setRewriteResult({
          jobId: job.id,
          mode: out.mode ?? job.jobType,
          selectedText: out.selectedText,
          newText: out.newText,
          start: sel.start,
          end: sel.end
        });
      } else {
        setRewriteNotice("任务已完成，但选区已失效，请重新选择文字后再试。");
      }
    }
    if (job?.status === "FAILED" && REWRITE_POLISH_JOB_TYPES.has(job.jobType)) {
      setRewriteNotice(job.errorMessage ?? "改写任务失败");
    }
  }, [job?.status, job?.jobType, job?.id, job?.output, job?.errorMessage]);

  const rewriteBusy =
    isStarting || (job ? ["QUEUED", "RUNNING"].includes(job.status) && REWRITE_POLISH_JOB_TYPES.has(job.jobType) : false);

  async function handleSelectChapter(id: string) {
    if (id === activeChapterId) return;
    await flush();
    setSelection(null);
    setRewriteResult(null);
    setRewriteNotice(null);
    setActiveChapterId(id);
  }

  async function handleGenerate(qualityMode: QualityMode, contextOptions?: ContextOptions) {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "GENERATE_CHAPTER", { qualityMode, contextOptions });
  }

  async function handleDiagnose(qualityMode: QualityMode) {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "DIAGNOSE_CHAPTER", { qualityMode });
  }

  async function handleDeslop() {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "DESLOP");
  }

  async function handleContinue() {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "CONTINUE_CHAPTER");
  }

  async function handleReview() {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "REVIEW");
  }

  async function handleGenerateOutline(chapterCount: number) {
    if (!projectId) return;
    await flush();
    await startJob(null, "GENERATE_OUTLINE", { projectId, chapterCount });
  }

  // 审校建议的「应用替换」：按引证原文定位并替换。
  // 引证已由 worker 端核对过存在性，这里再做一次当前正文的实时校验，
  // 防止审校后用户手动改过正文导致替换错位。
  const applyReviewReplacement = useCallback(
    (quote: string, replacement: string): boolean => {
      if (!quote) return false;
      const index = content.indexOf(quote);
      if (index < 0) return false;
      setContent(content.slice(0, index) + replacement + content.slice(index + quote.length));
      return true;
    },
    [content, setContent]
  );

  async function handleExtractMemory() {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "EXTRACT_MEMORY");
  }

  const handleRewrite = useCallback(
    async (jobType: "REWRITE" | "POLISH") => {
      const sel = selectionRef.current;
      if (!activeChapterId || !sel || sel.text.trim().length === 0) return;
      setRewriteResult(null);
      setRewriteNotice(null);
      await startJob(activeChapterId, jobType, { selectedText: sel.text });
    },
    [activeChapterId, startJob]
  );

  const applyRewrite = useCallback(() => {
    const result = rewriteResult;
    if (!result) return;
    const current = content;
    if (current.slice(result.start, result.end) !== result.selectedText) {
      setRewriteNotice("原文已发生变化，无法应用。请重新选择文字后再试。");
      setRewriteResult(null);
      return;
    }
    setContent(current.slice(0, result.start) + result.newText + current.slice(result.end));
    setRewriteResult(null);
    setRewriteNotice(null);
    setSelection(null);
  }, [rewriteResult, content, setContent]);

  const discardRewrite = useCallback(() => {
    setRewriteResult(null);
    setRewriteNotice(null);
  }, []);

  const selectionCount = selection?.text.length ?? 0;

  const selectionToolbar = (
    <>
      <span className="selection-toolbar-info">已选中 {selectionCount} 字</span>
      <button
        type="button"
        className="btn-ghost btn-small"
        onClick={() => void handleRewrite("REWRITE")}
        disabled={rewriteBusy || !activeChapterId}
      >
        改写
      </button>
      <button
        type="button"
        className="btn-ghost btn-small"
        onClick={() => void handleRewrite("POLISH")}
        disabled={rewriteBusy || !activeChapterId}
      >
        润色
      </button>
      <button
        type="button"
        className="btn-ghost btn-small"
        onClick={() => setSelection(null)}
        disabled={rewriteBusy}
        aria-label="取消选择"
      >
        取消
      </button>
    </>
  );

  const rewriteCard = rewriteResult ? (
    <div className="rewrite-result-card">
      <div className="rewrite-result-head">
        <strong>{rewriteResult.mode === "POLISH" ? "润色结果" : "改写结果"}</strong>
        <span className="muted">应用后将替换选中段落</span>
      </div>
      <div className="rewrite-result-diff">
        <div className="rewrite-result-block">
          <span className="muted">原文</span>
          <p>{rewriteResult.selectedText}</p>
        </div>
        <div className="rewrite-result-block rewrite-result-new">
          <span className="muted">新文</span>
          <p>{rewriteResult.newText}</p>
        </div>
      </div>
      <div className="rewrite-result-actions">
        <button type="button" className="btn-primary btn-small" onClick={applyRewrite}>
          应用到编辑器
        </button>
        <button type="button" className="btn-ghost btn-small" onClick={discardRewrite}>
          丢弃
        </button>
      </div>
    </div>
  ) : rewriteBusy ? (
    <div className="rewrite-result-card">
      <div className="rewrite-result-head">
        <strong>{job?.jobType === "POLISH" ? "润色中..." : "改写中..."}</strong>
      </div>
    </div>
  ) : rewriteNotice ? (
    <div className="rewrite-result-card">
      <p className="rewrite-result-notice">{rewriteNotice}</p>
    </div>
  ) : null;

  return (
    <div className="workspace">
      <AssetSidebar
        chapters={chapters}
        activeChapterId={activeChapterId}
        onSelect={(id) => void handleSelectChapter(id)}
        onCreate={async (input) => {
          const created = await createChapter(input);
          if (created) setActiveChapterId(created.id);
        }}
        isLoading={chaptersLoading}
      />
      <EditorPane
        title={activeChapter?.title ?? "未选择章节"}
        content={content}
        onChange={setContent}
        saveStatus={saveStatus}
        isLoadingContent={isLoadingContent}
        disabled={!activeChapterId}
        selection={selection}
        onSelectionChange={setSelection}
        selectionToolbar={selectionToolbar}
        rewriteCard={rewriteCard}
      />
      <WorkspaceSideTabs
        projectId={projectId}
        chapterId={activeChapterId}
        currentChapterText={content}
        onGenerate={handleGenerate}
        onDiagnose={handleDiagnose}
        onContinue={handleContinue}
        onReview={() => void handleReview()}
        onGenerateOutline={(count) => void handleGenerateOutline(count)}
        onApplyReviewReplacement={applyReviewReplacement}
        onDeslop={handleDeslop}
        onExtractMemory={handleExtractMemory}
        isStarting={isStarting}
        job={job}
        jobError={jobError}
        canGenerate={Boolean(activeChapterId)}
        onChapterContentRefreshed={() => {
          void reloadContent();
          void reloadChapters();
        }}
      />
    </div>
  );
}
