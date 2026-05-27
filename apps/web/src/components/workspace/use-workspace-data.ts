"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PerformanceSummary, QualityMode } from "@ai-novel/shared/generation/performance";

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

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters`);
      const json = (await res.json()) as ApiEnvelope<ChapterItem[]>;
      if (!res.ok || !json.success) throw new Error(json.error ?? `请求失败 (${res.status})`);
      setChapters(json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载章节失败");
    } finally {
      setLoading(false);
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

// 章节正文：进入时拉取一次；编辑后 debounce 1.5s 自动保存（PATCH）
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
      /* 忽略 */
    } finally {
      if (activeIdRef.current === id) setLoadingContent(false);
    }
  }, []);

  // 切章节：拉取最新正文
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

  // 卸载或切章节前 flush
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { content, setContent, saveStatus, isLoadingContent, flush, reload };
}

export interface JobSummary {
  id: string;
  jobType: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress: string | number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  performanceSummary?: PerformanceSummary;
  diagnosticType?: string;
  diagnosticSummary?: {
    readerScore?: number;
    abandonRisk?: string;
    hookStrength?: number;
    pacingScore?: number;
    styleDrift?: number;
    continuityIssues?: Array<{ severity?: string; detail?: string; suggestion?: string }>;
    suggestions?: string[];
  };
  steps?: Array<{
    id: string;
    stepKey: string;
    status: string;
    outputPreview: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    errorMessage: string | null;
  }>;
}

export type PerformanceTrendWindow = "7d" | "30d";

export interface PerformanceTrends {
  scope: "project" | "organization";
  window: PerformanceTrendWindow;
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencySamples: number;
    averageLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    estimatedCostCents: number | null;
  };
  daily: Array<{
    date: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    averageLatencyMs: number | null;
  }>;
  byModel: Array<{
    modelName: string;
    calls: number;
    totalTokens: number;
    averageLatencyMs: number | null;
  }>;
  byProvider: Array<{
    providerId: string | null;
    providerName: string | null;
    calls: number;
    totalTokens: number;
  }>;
  byBillingSource: Array<{
    billingSource: string;
    calls: number;
    totalTokens: number;
  }>;
  byJobType: Array<{
    jobType: string;
    calls: number;
    totalTokens: number;
  }>;
  byProject: Array<{
    projectId: string | null;
    projectTitle: string;
    projectSlug: string | null;
    calls: number;
    totalTokens: number;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
  }>;
  insights: Array<{
    id: string;
    severity: "info" | "warning" | "critical";
    category: "data" | "cost" | "latency" | "tokens" | "usage";
    title: string;
    detail: string;
    targetProjectId?: string | null;
    targetProjectTitle?: string;
    metricLabel?: string;
  }>;
}

interface UsePerformanceTrendsResult {
  trends: PerformanceTrends | null;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function usePerformanceTrends(projectId: string | null, window: PerformanceTrendWindow): UsePerformanceTrendsResult {
  const [trends, setTrends] = useState<PerformanceTrends | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrends = useCallback(async (id: string) => {
    const res = await fetch(`/api/projects/${id}/performance-trends?window=${window}`);
    const json = (await res.json()) as ApiEnvelope<PerformanceTrends>;
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error ?? `加载性能趋势失败 (${res.status})`);
    }
    return json.data;
  }, [window]);

  const reload = useCallback(async () => {
    if (!projectId) {
      setTrends(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTrends(await fetchTrends(projectId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载性能趋势失败");
      setTrends(null);
    } finally {
      setLoading(false);
    }
  }, [fetchTrends, projectId]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!projectId) {
        if (active) setTrends(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTrends(projectId);
        if (active) setTrends(data);
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : "加载性能趋势失败");
          setTrends(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [fetchTrends, projectId]);

  return { trends, isLoading, error, reload };
}

interface UseJobPollingResult {
  job: JobSummary | null;
  startJob: (chapterId: string, jobType?: string, options?: { qualityMode?: QualityMode }) => Promise<JobSummary | null>;
  isStarting: boolean;
  error: string | null;
}

// 创建生成任务并以 1.5s 轮询，直到 SUCCEEDED / FAILED / CANCELLED
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
        /* 单次失败忽略，下一轮继续 */
      }
      poll(jobId);
    }, 1500);
  }, [stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const startJob = useCallback(
    async (chapterId: string, jobType: string = "GENERATE_CHAPTER", options: { qualityMode?: QualityMode } = {}): Promise<JobSummary | null> => {
      setStarting(true);
      setError(null);
      try {
        const res = await fetch("/api/generation-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chapterId, jobType, ...(options.qualityMode ? { qualityMode: options.qualityMode } : {}) })
        });
        const json = (await res.json()) as ApiEnvelope<{ id: string; jobType: string; status: JobSummary["status"] }>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error ?? `创建任务失败 (${res.status})`);
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
        setError(err instanceof Error ? err.message : "创建任务失败");
        return null;
      } finally {
        setStarting(false);
      }
    },
    [poll]
  );

  return { job, startJob, isStarting, error };
}
