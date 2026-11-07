"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";
import type { QualityConstraints } from "@ai-novel/shared/generation/quality-constraints";
import { useParams } from "next/navigation";
import { AssetSidebar } from "../../../../../components/workspace/asset-sidebar";
import { EditorPane, type EditorSelection } from "../../../../../components/workspace/editor-pane";
import { WorkspaceSideTabs } from "../../../../../components/workspace/workspace-side-tabs";
import type { ReviewSource } from "../../../../../components/workspace/review-panel";
import {
  useChapters,
  useChapterContent,
  useJobPolling
} from "../../../../../components/workspace/use-workspace-data";

const REWRITE_POLISH_JOB_TYPES = new Set(["REWRITE", "POLISH"]);

interface RewriteResult {
  chapterId: string;
  sourceContent: string;
  jobId: string;
  mode: string;
  selectedText: string;
  newText: string;
  start: number;
  end: number;
}

interface RewriteRequest extends Omit<RewriteResult, "jobId" | "newText"> {
  jobId: string | null;
  sourceSha256: string | null;
}

export default function WorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? null;

  const {
    chapters,
    isLoading: chaptersLoading,
    isLoadingMore,
    hasMore,
    createChapter,
    reload: reloadChapters,
    loadMore
  } = useChapters(projectId);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeChapterId && chapters.length > 0) {
      setActiveChapterId(chapters[0]!.id);
    }
  }, [chapters, activeChapterId]);

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);

  // 字数变化不会改变章节数量，侧栏统计需要显式刷新信号。
  const [statsVersion, setStatsVersion] = useState(0);
  const bumpStats = useCallback(() => setStatsVersion((v) => v + 1), []);

  const {
    content,
    localDraft, localDraftError, restoreLocalDraft, discardLocalDraft,
    setContent,
    saveStatus,
    isLoadingContent,
    flush,
    reload: reloadContent,
    externalUpdateNotice,
    acceptExternalUpdate,
    dismissExternalUpdate
  } = useChapterContent(activeChapterId, { onSaved: bumpStats });
  const { job, startJob, isStarting, error: jobError, stopJob, isStopping, stopError } = useJobPolling();

  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(null);
  const [rewriteNotice, setRewriteNotice] = useState<string | null>(null);
  const [preparingRewrite, setPreparingRewrite] = useState(false);
  const [preparingReview, setPreparingReview] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const reviewPreparingRef = useRef(false);
  const rewriteRequestRef = useRef<RewriteRequest | null>(null);
  const currentEditorRef = useRef({ chapterId: activeChapterId, content });
  currentEditorRef.current = { chapterId: activeChapterId, content };
  const selectionRef = useRef<EditorSelection | null>(null);
  selectionRef.current = selection;

  useEffect(() => {
    if (job?.status === "SUCCEEDED" && !REWRITE_POLISH_JOB_TYPES.has(job.jobType)) {
      void reloadChapters();
      void reloadContent();
      bumpStats();
    }
  }, [job?.status, job?.jobType, reloadChapters, reloadContent, bumpStats]);

  useEffect(() => {
    if (job?.status === "SUCCEEDED" && REWRITE_POLISH_JOB_TYPES.has(job.jobType)) {
      const request = rewriteRequestRef.current;
      const out = job.output;
      if (!request || request.jobId !== job.id) return;
      rewriteRequestRef.current = null;
      if (request.chapterId !== currentEditorRef.current.chapterId) return;
      if (request.sourceContent !== currentEditorRef.current.content ||
        (out?.sourceSha256 !== undefined && out.sourceSha256 !== request.sourceSha256) ||
        (out?.chapterId !== undefined && out.chapterId !== request.chapterId)) {
        setRewriteNotice("原文已发生变化，无法应用。请重新选择文字后再试。");
      } else if (out?.newText && out.selectedText === request.selectedText) {
        setRewriteResult({
          chapterId: request.chapterId,
          sourceContent: request.sourceContent,
          jobId: job.id,
          mode: out.mode ?? job.jobType,
          selectedText: out.selectedText,
          newText: out.newText,
          start: request.start,
          end: request.end
        });
      } else {
        setRewriteNotice("任务已完成，但选区已失效，请重新选择文字后再试。");
      }
    }
    if (job && ["FAILED", "CANCELLED"].includes(job.status) && REWRITE_POLISH_JOB_TYPES.has(job.jobType) && rewriteRequestRef.current?.jobId === job.id) {
      const request = rewriteRequestRef.current;
      rewriteRequestRef.current = null;
      if (request.chapterId === currentEditorRef.current.chapterId) setRewriteNotice(job.errorMessage ?? (job.status === "CANCELLED" ? "任务已取消，未采用候选" : "改写任务失败"));
    }
  }, [job?.status, job?.jobType, job?.id, job?.output, job?.errorMessage]);

  const rewriteBusy =
    preparingRewrite || isStarting || (job ? ["QUEUED", "RUNNING"].includes(job.status) && REWRITE_POLISH_JOB_TYPES.has(job.jobType) : false);

  async function handleSelectChapter(id: string) {
    if (id === activeChapterId) return;
    rewriteRequestRef.current = null;
    if (!await flush()) return;
    setSelection(null);
    setRewriteResult(null);
    setRewriteNotice(null);
    setReviewNotice(null);
    setActiveChapterId(id);
  }

  async function handleGenerate(qualityMode: QualityMode, contextOptions?: ContextOptions, qualityConstraints?: QualityConstraints) {
    if (!activeChapterId) return;
    if (!await flush()) return;
    await startJob(activeChapterId, "GENERATE_CHAPTER", { qualityMode, contextOptions, qualityConstraints });
  }

  async function handleDiagnose(qualityMode: QualityMode) {
    if (!activeChapterId) return;
    if (!await flush()) return;
    await startJob(activeChapterId, "DIAGNOSE_CHAPTER", { qualityMode });
  }

  async function handleDeslop() {
    if (!activeChapterId) return;
    if (!await flush()) return;
    await startJob(activeChapterId, "DESLOP");
  }

  async function handleContinue() {
    if (!activeChapterId) return;
    if (!await flush()) return;
    await startJob(activeChapterId, "CONTINUE_CHAPTER");
  }

  async function handleBatchContinue(chapterCount: number, extractMemory: boolean) {
    if (!activeChapterId) return;
    if (!await flush()) return;
    await startJob(activeChapterId, "BATCH_CONTINUE", { chapterCount, extractMemory });
  }

  // 章节状态流转（待写/草稿/审阅中/定稿）：写库后刷新列表让侧栏标签同步
  async function handleChapterStatusChange(status: string) {
    if (!activeChapterId) return;
    try {
      const res = await fetch(`/api/chapters/${activeChapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (res.ok) void reloadChapters();
    } catch {
      // 状态标记失败不阻断写作；下次操作会重试
    }
  }

  async function handleReview() {
    if (!activeChapterId || isLoadingContent || isStarting || reviewPreparingRef.current) return;
    const source = currentEditorRef.current;
    reviewPreparingRef.current = true; setPreparingReview(true); setReviewNotice(null);
    try {
      const saved = await flush();
      if (source.chapterId !== currentEditorRef.current.chapterId) return;
      if (!saved || source.content !== currentEditorRef.current.content) { setReviewNotice("正文未保存或已变化，请核对后重新审校。"); return; }
      await startJob(source.chapterId, "REVIEW");
    } finally { reviewPreparingRef.current = false; setPreparingReview(false); }
  }

  async function handleGenerateOutline(chapterCount: number) {
    if (!projectId) return;
    if (!await flush()) return;
    await startJob(null, "GENERATE_OUTLINE", { projectId, chapterCount });
  }

  // 审校建议的「应用替换」：按引证原文定位并替换。
  // 引证已由 worker 端核对过存在性，这里再做一次当前正文的实时校验，
  // 防止审校后用户手动改过正文导致替换错位。
  const applyReviewReplacement = useCallback(
    (quote: string, replacement: string, source: ReviewSource): boolean => {
      const current = currentEditorRef.current;
      if (!quote || current.chapterId !== source.chapterId || current.content !== source.content) return false;
      const index = current.content.indexOf(quote);
      if (index < 0 || current.content.indexOf(quote, index + 1) !== -1) return false;
      const next = current.content.slice(0, index) + replacement + current.content.slice(index + quote.length);
      currentEditorRef.current = { chapterId: current.chapterId, content: next };
      setContent(next);
      return true;
    },
    [setContent]
  );

  async function handleExtractMemory() {
    if (!activeChapterId) return;
    if (!await flush()) return;
    await startJob(activeChapterId, "EXTRACT_MEMORY");
  }

  const handleRewrite = useCallback(
    async (jobType: "REWRITE" | "POLISH") => {
      const sel = selectionRef.current;
      if (!activeChapterId || !sel || !sel.text.trim() || isLoadingContent || rewriteRequestRef.current) return;
      if (content.slice(sel.start, sel.end) !== sel.text) return;
      const request: RewriteRequest = { jobId: null, sourceSha256: null, chapterId: activeChapterId, sourceContent: content, mode: jobType, selectedText: sel.text, start: sel.start, end: sel.end };
      rewriteRequestRef.current = request;
      setPreparingRewrite(true);
      setRewriteResult(null);
      setRewriteNotice(null);
      try {
        const saved = await flush();
        if (rewriteRequestRef.current !== request) return;
        if (currentEditorRef.current.chapterId !== request.chapterId || currentEditorRef.current.content !== request.sourceContent) {
          rewriteRequestRef.current = null;
          if (currentEditorRef.current.chapterId === request.chapterId) setRewriteNotice("原文已发生变化，未提交任务。请重新选择文字后再试。");
          return;
        }
        if (!saved) { rewriteRequestRef.current = null; setRewriteNotice("正文保存失败，未提交改写任务；请保存后重试。"); return; }
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.sourceContent));
        request.sourceSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (rewriteRequestRef.current !== request) return;
        const current = currentEditorRef.current;
        if (current.chapterId !== request.chapterId || current.content !== request.sourceContent) {
          rewriteRequestRef.current = null;
          if (current.chapterId === request.chapterId) setRewriteNotice("原文已发生变化，未提交任务。请重新选择文字后再试。");
          return;
        }
        const started = await startJob(request.chapterId, jobType, { selectedText: request.selectedText });
        if (rewriteRequestRef.current !== request) return;
        if (!started) { rewriteRequestRef.current = null; return; }
        request.jobId = started.id;
      } finally { setPreparingRewrite(false); }
    },
    [activeChapterId, content, isLoadingContent, flush, startJob]
  );

  const applyRewrite = useCallback(() => {
    const result = rewriteResult;
    if (!result) return;
    const current = content;
    if (activeChapterId !== result.chapterId || current !== result.sourceContent || current.slice(result.start, result.end) !== result.selectedText) {
      setRewriteNotice("原文已发生变化，无法应用。请重新选择文字后再试。");
      setRewriteResult(null);
      return;
    }
    setContent(current.slice(0, result.start) + result.newText + current.slice(result.end));
    setRewriteResult(null);
    setRewriteNotice(null);
    setSelection(null);
    bumpStats();
  }, [rewriteResult, activeChapterId, content, setContent, bumpStats]);

  const discardRewrite = useCallback(() => {
    rewriteRequestRef.current = null;
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
          const sourceChapterId = activeChapterId;
          if (!await flush()) return;
          const created = await createChapter(input);
          if (currentEditorRef.current.chapterId !== sourceChapterId || !await flush()) return;
          if (created) {
            rewriteRequestRef.current = null;
            setSelection(null); setRewriteResult(null); setRewriteNotice(null);
            setActiveChapterId(created.id);
          }
        }}
        isLoading={chaptersLoading}
        exportHref={projectId ? `/api/projects/${projectId}/export` : null}
        projectId={projectId}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={() => void loadMore()}
        onChapterMoved={() => void reloadChapters()}
        statsVersion={statsVersion}
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
        externalUpdateNotice={externalUpdateNotice}
        localDraft={localDraft}
        localDraftError={localDraftError}
        onRestoreLocalDraft={restoreLocalDraft}
        onDiscardLocalDraft={discardLocalDraft}
        onAcceptExternalUpdate={() => void acceptExternalUpdate()}
        onDismissExternalUpdate={dismissExternalUpdate}
        chapterStatus={activeChapter?.status ?? null}
        onStatusChange={(status) => void handleChapterStatusChange(status)}
      />
      <WorkspaceSideTabs
        projectId={projectId}
        chapterId={activeChapterId}
        currentChapterText={content}
        onPrepareVersionRestore={async () => !isLoadingContent && await flush()}
        onGenerate={handleGenerate}
        onDiagnose={handleDiagnose}
        onContinue={handleContinue}
        onBatchContinue={handleBatchContinue}
        onStopJob={() => void stopJob()}
        stopping={isStopping}
        stopError={stopError}
        onReview={() => void handleReview()}
        preparingReview={preparingReview}
        reviewNotice={reviewNotice}
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
          bumpStats();
        }}
      />
      <button
        type="button"
        className="mobile-editor-jump"
        onClick={() => {
          const editor = document.querySelector(".editor-textarea");
          if (editor instanceof HTMLElement) editor.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      >
        回到正文
      </button>
    </div>
  );
}
