"use client";

import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";
import type { QualityConstraints } from "@ai-novel/shared/generation/quality-constraints";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildGenerationRequestBody } from "./job-request";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ChapterItem {
  id: string;
  chapterNo: number;
  title: string;
  status: string;
  wordCount: number;
  content?: string;
  updatedAt?: string;
}

interface UseChaptersResult {
  chapters: ChapterItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  total: number | null;
  error: string | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  createChapter: (input: { title: string }) => Promise<ChapterItem | null>;
}

const CHAPTER_PAGE_SIZE = 50;

interface ChapterPagePayload {
  items: ChapterItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function useChapters(projectId: string | null): UseChaptersResult {
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadSeqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!projectId) return;
    const seq = ++reloadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters?page=1&pageSize=${CHAPTER_PAGE_SIZE}`
      );
      const json = (await res.json()) as ApiEnvelope<ChapterPagePayload>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `请求失败 (${res.status})`);
      }
      if (reloadSeqRef.current !== seq) return;
      setChapters(json.data.items);
      setTotal(json.data.total);
    } catch (err: unknown) {
      if (reloadSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : "章节加载失败");
    } finally {
      if (reloadSeqRef.current === seq) setLoading(false);
    }
  }, [projectId]);

  // 增量加载：侧栏「加载更多」。分页请求走同一接口，已加载的章节保持不动，
  // 避免整表重取导致的滚动位置丢失。
  const loadMore = useCallback(async () => {
    if (!projectId) return;
    setLoadingMore(true);
    try {
      const nextPage = Math.floor(chapters.length / CHAPTER_PAGE_SIZE) + 1;
      const res = await fetch(
        `/api/projects/${projectId}/chapters?page=${nextPage}&pageSize=${CHAPTER_PAGE_SIZE}`
      );
      const json = (await res.json()) as ApiEnvelope<ChapterPagePayload>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `请求失败 (${res.status})`);
      }
      setChapters((prev) => {
        const seen = new Set(prev.map((chapter) => chapter.id));
        return [...prev, ...json.data!.items.filter((chapter) => !seen.has(chapter.id))];
      });
      setTotal(json.data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, chapters.length]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createChapter = useCallback(
    async (input: { title: string }): Promise<ChapterItem | null> => {
      if (!projectId) return null;
      const res = await fetch(`/api/projects/${projectId}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const json = (await res.json()) as ApiEnvelope<ChapterItem>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `创建章节失败 (${res.status})`);
      }
      await reload();
      return json.data;
    },
    [projectId, reload]
  );

  return {
    chapters,
    isLoading,
    isLoadingMore,
    hasMore: total !== null && chapters.length < total,
    total,
    error,
    reload,
    loadMore,
    createChapter
  };
}

interface UseChapterContentResult {
  content: string;
  setContent: (v: string) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  isLoadingContent: boolean;
  flush: () => Promise<boolean>;
  reload: () => Promise<void>;
  externalUpdateNotice: boolean;
  acceptExternalUpdate: () => Promise<void>;
  dismissExternalUpdate: () => void;
}

export function useChapterContent(
  chapterId: string | null,
  options: { debounceMs?: number; onSaved?: () => void } = {}
): UseChapterContentResult {
  const debounceMs = options.debounceMs ?? 1500;
  const onSaved = options.onSaved;
  const [content, setContentState] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isLoadingContent, setLoadingContent] = useState(false);
  const [externalUpdateNotice, setExternalUpdateNotice] = useState(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const activeIdRef = useRef<string | null>(null);
  // 供卸载/隐藏钩子读取最新正文，避免闭包拿到过期值
  const contentRef = useRef("");
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const fetchContent = useCallback(async (id: string) => {
    setLoadingContent(true);
    try {
      const res = await fetch(`/api/chapters/${id}`);
      const json = (await res.json()) as ApiEnvelope<{ content: string }>;
      if (json.success && json.data && activeIdRef.current === id) {
        const remote = json.data.content ?? "";
        // 本地有未保存改动时不能直接覆盖——AI 任务回写触发的刷新
        // 会把用户正在输入的内容吞掉。保留本地内容并提示冲突。
        if (dirtyRef.current && remote !== contentRef.current) {
          setExternalUpdateNotice(true);
        } else {
          setContentState(remote);
          contentRef.current = remote;
          dirtyRef.current = false;
          setSaveStatus("idle");
          setExternalUpdateNotice(false);
        }
      }
    } catch {
      // Ignore one-off load failures; the editor can retry on reload.
    } finally {
      if (activeIdRef.current === id) setLoadingContent(false);
    }
  }, []);

  useEffect(() => {
    activeIdRef.current = chapterId;
    if (!chapterId) {
      setContentState("");
      return;
    }
    void fetchContent(chapterId);
  }, [chapterId, fetchContent]);

  const persist = useCallback(
    (text: string, idAtCall: string) => {
      const saving = saveQueueRef.current.then(async () => {
        // An older request must finish before the next one can reach the server.
        // A queued draft superseded in this editor no longer needs to be written.
        if (activeIdRef.current === idAtCall && contentRef.current !== text) return false;
        if (activeIdRef.current === idAtCall) setSaveStatus("saving");
        try {
          const res = await fetch(`/api/chapters/${idAtCall}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text })
          });
          const json = (await res.json()) as ApiEnvelope<unknown>;
          if (!res.ok || !json.success) throw new Error(json.error ?? `保存失败 (${res.status})`);
          if (activeIdRef.current === idAtCall && contentRef.current === text) {
            dirtyRef.current = false;
            setSaveStatus("saved");
            onSaved?.();
          }
          return true;
        } catch {
          if (activeIdRef.current === idAtCall) setSaveStatus("error");
          return false;
        }
      });
      saveQueueRef.current = saving.catch(() => undefined);
      return saving;
    },
    [onSaved]
  );

  const setContent = useCallback(
    (value: string) => {
      setContentState(value);
      contentRef.current = value;
      if (!chapterId) return;
      dirtyRef.current = true;
      setSaveStatus("idle");
      if (timerRef.current) clearTimeout(timerRef.current);
      const idAtCall = chapterId;
      timerRef.current = setTimeout(() => {
        if (dirtyRef.current && activeIdRef.current === idAtCall) {
          void persist(value, idAtCall);
        }
      }, debounceMs);
    },
    [chapterId, debounceMs, persist]
  );

  const flush = useCallback(async () => {
    if (!chapterId || !dirtyRef.current) return true;
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(content, chapterId);
  }, [chapterId, content, persist]);

  // 离开保护：防抖窗口内直接关闭标签页会丢字。
  // 1) 页面隐藏（切后台/关标签）时用 keepalive 补一次保存——浏览器会在页面销毁后继续发送；
  // 2) beforeunload 时若仍有未保存内容，弹原生确认，给用户反悔机会。
  useEffect(() => {
    if (!chapterId) return;

    function handleVisibilityChange() {
      if (document.visibilityState !== "hidden") return;
      if (!dirtyRef.current) return;
      const text = contentRef.current;
      const id = activeIdRef.current;
      if (!id) return;
      // keepalive 让请求在页面卸载后仍能完成，避免丢失最后一段输入
      void fetch(`/api/chapters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
        keepalive: true
      }).catch(() => undefined);
      dirtyRef.current = false;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [chapterId]);

  const reload = useCallback(async () => {
    if (chapterId) await fetchContent(chapterId);
  }, [chapterId, fetchContent]);

  // 放弃本地改动、接受远端最新内容（AI 回写 / 其他标签页）
  const acceptExternalUpdate = useCallback(async () => {
    if (!chapterId) return;
    dirtyRef.current = false;
    setExternalUpdateNotice(false);
    await fetchContent(chapterId);
  }, [chapterId, fetchContent]);

  const dismissExternalUpdate = useCallback(() => {
    setExternalUpdateNotice(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    content,
    setContent,
    saveStatus,
    isLoadingContent,
    flush,
    reload,
    externalUpdateNotice,
    acceptExternalUpdate,
    dismissExternalUpdate
  };
}

export interface PerformanceSummaryView {
  qualityMode: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  skippedSteps?: Array<{ stepKey: string; reason: string }>;
  contextBudget?: { tokenBudget: number; appliedTokenBudget: number; estimatedTokens: number; includedCount: number; trimmedCount: number };
  contextFingerprint?: { hash: string; chapterId: string; contextOptionsHash: string; sourceUpdatedAt: string };
}

export interface DiagnosticSummaryView {
  readerScore: number;
  abandonRisk: string;
  hookStrength: number;
  pacingScore: number;
  styleDrift: number;
  continuityIssues?: Array<{ severity: string; detail: string; suggestion: string }>;
  suggestions?: string[];
}

export interface JobSummary {
  id: string;
  jobType: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress: string | number;
  errorMessage: string | null;
  output?: {
    contextSummary?: {
      budgetPreset: string;
      includedCount: number;
      trimmedCount: number;
      forcedCount: number;
      excludedCount: number;
    };
    performanceSummary?: PerformanceSummaryView;
    diagnosticSummary?: DiagnosticSummaryView;
    deslopReport?: {
      overallScore: number; summary: string; sourceChars: number; sourceSha256: string;
      issues: Array<{ category: string; severity: "info" | "warning" | "error"; matched: string; suggestion: string; position: { start: number; end: number } }>;
    };
    qualitySummary?: { passed: boolean; charCount: number; minChars?: number; maxChars?: number; lengthPassed: boolean; missingFacts: string[] };
    diagnosticDegraded?: boolean;
    diagnosticWarning?: string;
    generationWarnings?: Array<{ stepKey: string; code: string; message: string }>;
    mode?: string;
    selectedText?: string;
    newText?: string;
    chapterId?: string;
    sourceSha256?: string;
    review?: {
      summary: string;
      passed: boolean;
      suggestions: Array<{
        issueType: string;
        severity: "info" | "warning" | "error";
        quote: string;
        problem: string;
        suggestion: string;
        replacement?: string;
        verified: boolean;
      }>;
      verifiedCount: number;
      unverifiedCount: number;
      degraded: boolean;
    };
  } | null;
  startedAt: string | null;
  finishedAt: string | null;
  steps?: Array<{
    id: string;
    stepKey: string;
    status: string;
    outputPreview: string | null;
    promptSnapshot: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    errorMessage: string | null;
  }>;
}

interface UseJobPollingResult {
  stopJob: () => Promise<void>;
  isStopping: boolean;
  stopError: string | null;
  job: JobSummary | null;
  startJob: (chapterId: string | null, jobType?: string, options?: StartJobOptions) => Promise<JobSummary | null>;
  isStarting: boolean;
  error: string | null;
}

interface StartJobOptions {
  qualityConstraints?: QualityConstraints;
  contextOptions?: ContextOptions;
  qualityMode?: QualityMode;
  selectedText?: string;
  instruction?: string;
  projectId?: string;
  chapterCount?: number;
  extractMemory?: boolean;
}

export function useJobPolling(): UseJobPollingResult {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [isStarting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const scopeRef = useRef(0);
  const jobRef = useRef<JobSummary | null>(null);
  const readRef = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null });
  const stopRef = useRef<AbortController | null>(null);
  const createRef = useRef<AbortController | null>(null);
  const pendingCreateRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    readRef.current.sequence++;
    readRef.current.controller?.abort();
    readRef.current.controller = null;
  }, []);

  const isCurrent = useCallback((scope: number, id: string) => scopeRef.current === scope && jobRef.current?.id === id, []);
  const isTerminal = (status: string) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);
  const acceptJob = useCallback((next: JobSummary) => {
    const current = jobRef.current;
    // A read issued before cancellation/completion must never regress a terminal card.
    if (current?.id === next.id && isTerminal(current.status) && current.status !== next.status) return;
    jobRef.current = next;
    setJob(next);
  }, []);

  const refreshJob = useCallback(async (scope: number, id: string): Promise<boolean> => {
    if (!isCurrent(scope, id)) return false;
    stopPolling();
    const sequence = readRef.current.sequence;
    const controller = new AbortController();
    readRef.current.controller = controller;
    try {
      const response = await fetch(`/api/generation-jobs/${id}`, { signal: controller.signal });
      const json = await response.json() as ApiEnvelope<JobSummary>;
      if (!isCurrent(scope, id) || controller.signal.aborted || readRef.current.sequence !== sequence) return false;
      if (!response.ok || !json.success || !json.data || json.data.id !== id || !["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"].includes(json.data.status)) return false;
      acceptJob(json.data);
      return true;
    } catch { return false; }
    finally { if (readRef.current.controller === controller) readRef.current.controller = null; }
  }, [acceptJob, isCurrent, stopPolling]);

  const poll = useCallback(function schedule(scope: number, id: string) {
    if (!isCurrent(scope, id) || isTerminal(jobRef.current!.status)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const scheduledSequence = readRef.current.sequence;
    timerRef.current = setTimeout(async () => {
      if (!isCurrent(scope, id) || readRef.current.sequence !== scheduledSequence) return;
      timerRef.current = null;
      // refreshJob advances the read generation synchronously before awaiting I/O.
      const ownedSequence = scheduledSequence + 1;
      await refreshJob(scope, id);
      if (isCurrent(scope, id) && readRef.current.sequence === ownedSequence && !isTerminal(jobRef.current!.status)) schedule(scope, id);
    }, 1500);
  }, [isCurrent, refreshJob]);

  useEffect(() => () => {
    scopeRef.current++;
    stopPolling(); stopRef.current?.abort(); createRef.current?.abort();
  }, [stopPolling]);

  const startJob = useCallback(async (chapterId: string | null, jobType: string = "GENERATE_CHAPTER", options?: StartJobOptions): Promise<JobSummary | null> => {
    if (createRef.current) return null;
    const scope = ++scopeRef.current;
    stopPolling(); stopRef.current?.abort(); stopRef.current = null;
    const controller = new AbortController(); createRef.current = controller;
    setStarting(true); setError(null); setStopping(false); setStopError(null);
    try {
      const body = buildGenerationRequestBody({ chapterId, projectId: options?.projectId, jobType,
        qualityMode: options?.qualityMode, qualityConstraints: options?.qualityConstraints, contextOptions: options?.contextOptions,
        selectedText: options?.selectedText, instruction: options?.instruction, chapterCount: options?.chapterCount, extractMemory: options?.extractMemory });
      const fingerprint = JSON.stringify(body);
      if (pendingCreateRef.current?.fingerprint !== fingerprint) pendingCreateRef.current = { fingerprint, requestId: crypto.randomUUID() };
      body.requestId = pendingCreateRef.current.requestId;
      const response = await fetch("/api/generation-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const json = await response.json() as ApiEnvelope<JobSummary>;
      if (scopeRef.current !== scope || controller.signal.aborted) return null;
      if ([400, 401, 403, 404, 409].includes(response.status)) pendingCreateRef.current = null;
      if (!response.ok || !json.success || !json.data || typeof json.data.id !== "string" || !["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"].includes(json.data.status)) throw new Error(json.error ?? `创建生成任务失败 (${response.status})`);
      pendingCreateRef.current = null;
      const initial: JobSummary = { ...json.data, progress: json.data.progress ?? "0", errorMessage: json.data.errorMessage ?? null, startedAt: json.data.startedAt ?? null, finishedAt: json.data.finishedAt ?? null };
      jobRef.current = initial; setJob(initial); poll(scope, initial.id);
      return initial;
    } catch (err: unknown) {
      if (scopeRef.current === scope && !controller.signal.aborted) {
        setError(err instanceof Error && /[\u4e00-\u9fff]/.test(err.message) ? err.message : "未确认任务是否创建；再次提交相同参数可找回原任务。");
        // Keep observing the previous task if creation failed.
        if (jobRef.current) poll(scope, jobRef.current.id);
      }
      return null;
    } finally {
      if (scopeRef.current === scope) { setStarting(false); if (createRef.current === controller) createRef.current = null; }
    }
  }, [poll, stopPolling]);

  const stopJob = useCallback(async () => {
    const current = jobRef.current;
    if (!current || isTerminal(current.status) || stopRef.current || createRef.current) return;
    const scope = scopeRef.current; const id = current.id;
    const controller = new AbortController(); stopRef.current = controller;
    setStopping(true); setStopError(null);
    try {
      const response = await fetch(`/api/generation-jobs/${id}/cancel`, { method: "POST", signal: controller.signal });
      const json = await response.json().catch(() => null) as ApiEnvelope<{ id: string; status: string }> | null;
      if (!isCurrent(scope, id) || controller.signal.aborted) return;
      if (response.status === 409) {
        setStopError("任务已结束，无需停止；正在刷新状态。");
        const refreshed = await refreshJob(scope, id);
        if (isCurrent(scope, id)) setStopError(refreshed ? "任务已结束，无需停止。" : "任务已结束，无需停止；暂未取得最新状态，将继续刷新。");
      } else if (response.ok && json?.success && json.data?.id === id && json.data.status === "CANCELLED") {
        stopPolling();
        acceptJob({ ...jobRef.current!, status: "CANCELLED" });
        await refreshJob(scope, id);
      } else {
        const message = response.status === 401 ? "未登录或会话已过期，请重新登录后查看任务状态。"
          : response.status === 404 ? "任务不存在或无权访问，未确认停止。"
          : !response.ok && typeof json?.error === "string" && json.error.trim() ? json.error : "未确认任务已停止，请重试或查看最新状态。";
        setStopError(message);
      }
    } catch {
      if (isCurrent(scope, id) && !controller.signal.aborted) setStopError("网络异常，未确认任务已停止；请重试。");
    } finally {
      if (isCurrent(scope, id) && stopRef.current === controller) {
        stopRef.current = null; setStopping(false);
        if (!isTerminal(jobRef.current!.status)) poll(scope, id);
      }
    }
  }, [acceptJob, isCurrent, poll, refreshJob, stopPolling]);

  return { job, startJob, isStarting, error, stopJob, isStopping, stopError };
}
