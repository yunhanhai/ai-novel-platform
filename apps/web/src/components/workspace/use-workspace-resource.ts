"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ResourceState<T> {
  items: T[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (body: unknown, query?: Record<string, string>) => Promise<T | null>;
  patch: (id: string, body: unknown) => Promise<T | null>;
  deactivate: (id: string) => Promise<T | null>;
}

// 通用资源 hook：支持 list / create / patch / deactivate（针对 /api/<resource> 风格）
export function useWorkspaceResource<T>(params: {
  endpoint: string;          // 例如 "/api/style-profiles"
  projectId: string | null;
  listQuery?: Record<string, string | undefined>;
  enabled?: boolean;         // 默认 true
}): ResourceState<T> {
  const { endpoint, projectId, enabled = true, listQuery } = params;
  const listQueryKey = JSON.stringify(listQuery ?? {});
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    if (!enabled || !projectId) return;
    setLoading(true);
    setError(null);
    try {
      const searchParams = new URLSearchParams({ projectId });
      const extraQuery = JSON.parse(listQueryKey) as Record<string, string | undefined>;
      for (const [key, value] of Object.entries(extraQuery)) {
        if (value) searchParams.set(key, value);
      }
      const res = await fetch(`${endpoint}?${searchParams.toString()}`);
      const json = (await res.json()) as ApiEnvelope<T[]>;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `请求失败 (${res.status})`);
      }
      setItems(json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }, [endpoint, projectId, enabled, listQueryKey]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const create = useCallback(
    async (body: unknown, query?: Record<string, string>): Promise<T | null> => {
      const search = query ? `?${new URLSearchParams(query).toString()}` : "";
      const res = await fetch(`${endpoint}${search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await res.json()) as ApiEnvelope<T>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `创建失败 (${res.status})`);
      }
      await fetchList();
      return json.data;
    },
    [endpoint, fetchList]
  );

  const patch = useCallback(
    async (id: string, body: unknown): Promise<T | null> => {
      const res = await fetch(`${endpoint}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await res.json()) as ApiEnvelope<T>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `更新失败 (${res.status})`);
      }
      await fetchList();
      return json.data;
    },
    [endpoint, fetchList]
  );

  const deactivate = useCallback(
    async (id: string): Promise<T | null> => {
      const res = await fetch(`${endpoint}/${id}`, { method: "DELETE" });
      const json = (await res.json()) as ApiEnvelope<T>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `停用失败 (${res.status})`);
      }
      await fetchList();
      return json.data;
    },
    [endpoint, fetchList]
  );

  return { items, isLoading, error, reload: fetchList, create, patch, deactivate };
}
