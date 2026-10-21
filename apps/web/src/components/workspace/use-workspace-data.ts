"use client";

import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";
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
  error: string | null;
  reload: () => Promise<void>;
  createChapter: (input: { chapterNo: number; title: string }) => Promise<ChapterItem | null>;
}

export function useChapters(projectId: string | null): UseChaptersResult {
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadSeqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!projectId) return;
    const seq = ++reloadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters`);
      const json = (await res.json()) as ApiEnvelope<ChapterItem[]>;
      if (!res.ok || !json.success) throw new Error(json.error ?? `请求失败 (${res.status})`);
      if (reloadSeqRef.current !== seq) return;
      setChapters(json.data ?? []);
    } catch (err: unknown) {
      if (reloadSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : "章节加载失败");
    } finally {
      if (reloadSeqRef.current === seq) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createChapter = useCallback(
    async (input: { chapterNo: number; title: string }): Promise<ChapterItem | null> => {
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

  return { chapters, isLoading, error, reload, createChapter };
}

interface UseChapterContentResult {
  content: string;
  setContent: (v: string) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  isLoadingContent: boolean;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useChapterContent(
  chapterId: string | null,
  options: { debounceMs?: number } = {}
): UseChapterContentResult {
  const debounceMs = options.debounceMs ?? 1500;
  const [content, setContentState] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isLoadingContent, setLoadingContent] = useState(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const activeIdRef = useRef<string | null>(null);

  const fetchContent = useCallback(async (id: string) => {
    setLoadingContent(true);
    try {
      const res = await fetch(`/api/chapters/${id}`);
      const json = (await res.json()) as ApiEnvelope<{ content: string }>;
      if (json.success && json.data && activeIdRef.current === id) {
        setContentState(json.data.content ?? "");
        dirtyRef.current = false;
        setSaveStatus("idle");
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
    async (text: string, idAtCall: string) => {
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/chapters/${idAtCall}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text })
        });
        const json = (await res.json()) as ApiEnvelope<unknown>;
        if (!res.ok || !json.success) throw new Error(json.error ?? `保存失败 (${res.status})`);
        if (activeIdRef.current === idAtCall) {
          dirtyRef.current = false;
          setSaveStatus("saved");
        }
      } catch {
        if (activeIdRef.current === idAtCall) setSaveStatus("error");
      }
    },
    []
  );

  const setContent = useCallback(
    (value: string) => {
      setContentState(value);
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
    if (!chapterId || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    await persist(content, chapterId);
  }, [chapterId, content, persist]);

  const reload = useCallback(async () => {
    if (chapterId) await fetchContent(chapterId);
  }, [chapterId, fetchContent]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { content, setContent, saveStatus, isLoadingContent, flush, reload };
}

export interface PerformanceSummaryView {
  qualityMode: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  skippedSteps?: Array<{ stepKey: string; reason: string }>;
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
    diagnosticDegraded?: boolean;
    diagnosticWarning?: string;
    mode?: string;
    selectedText?: string;
    newText?: string;
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
  job: JobSummary | null;
  startJob: (chapterId: string | null, jobType?: string, options?: StartJobOptions) => Promise<JobSummary | null>;
  isStarting: boolean;
  error: string | null;
}

interface StartJobOptions {
  contextOptions?: ContextOptions;
  qualityMode?: QualityMode;
  selectedText?: string;
  instruction?: string;
  projectId?: string;
  chapterCount?: number;
}

export function useJobPolling(): UseJobPollingResult {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [isStarting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const poll = useCallback((jobId: string) => {
    stopPolling();
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/generation-jobs/${jobId}`);
        const json = (await res.json()) as ApiEnvelope<JobSummary>;
        if (json.success && json.data) {
          setJob(json.data);
          if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(json.data.status)) return;
        }
      } catch {
        // Ignore one polling failure and retry on the next tick.
      }
      poll(jobId);
    }, 1500);
  }, [stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const startJob = useCallback(
    async (chapterId: string | null, jobType: string = "GENERATE_CHAPTER", options?: StartJobOptions): Promise<JobSummary | null> => {
      setStarting(true);
      setError(null);
      try {
        const body = buildGenerationRequestBody({
          chapterId,
          projectId: options?.projectId,
          jobType,
          qualityMode: options?.qualityMode,
          contextOptions: options?.contextOptions,
          selectedText: options?.selectedText,
          instruction: options?.instruction,
          chapterCount: options?.chapterCount
        });
        const res = await fetch("/api/generation-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const json = (await res.json()) as ApiEnvelope<{ id: string; jobType: string; status: JobSummary["status"] }>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error ?? `创建生成任务失败 (${res.status})`);
        }
        const initial: JobSummary = {
          id: json.data.id,
          jobType: json.data.jobType,
          status: json.data.status,
          progress: "0",
          errorMessage: null,
          startedAt: null,
          finishedAt: null
        };
        setJob(initial);
        poll(initial.id);
        return initial;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "创建生成任务失败");
        return null;
      } finally {
        setStarting(false);
      }
    },
    [poll]
  );

  return { job, startJob, isStarting, error };
}
