import type { PrismaClient } from "@ai-novel/db";

export type PerformanceTrendWindow = "7d" | "30d";

export interface PerformanceTrendTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencySamples: number;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  estimatedCostCents: number | null;
}

export interface DailyPerformanceTrend {
  date: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  averageLatencyMs: number | null;
}

export interface ModelPerformanceBreakdown {
  modelName: string;
  calls: number;
  totalTokens: number;
  averageLatencyMs: number | null;
}

export interface ProviderPerformanceBreakdown {
  providerId: string | null;
  providerName: string | null;
  calls: number;
  totalTokens: number;
}

export interface BillingSourcePerformanceBreakdown {
  billingSource: string;
  calls: number;
  totalTokens: number;
}

export interface JobTypePerformanceBreakdown {
  jobType: string;
  calls: number;
  totalTokens: number;
}

export interface ProjectPerformanceBreakdown {
  projectId: string | null;
  projectTitle: string;
  projectSlug: string | null;
  calls: number;
  totalTokens: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface PerformanceInsight {
  id: string;
  severity: "info" | "warning" | "critical";
  category: "data" | "cost" | "latency" | "tokens" | "usage";
  title: string;
  detail: string;
  targetProjectId?: string | null;
  targetProjectTitle?: string;
  metricLabel?: string;
}

export interface PerformanceTrends {
  scope: "project" | "organization";
  window: PerformanceTrendWindow;
  totals: PerformanceTrendTotals;
  daily: DailyPerformanceTrend[];
  byModel: ModelPerformanceBreakdown[];
  byProvider: ProviderPerformanceBreakdown[];
  byBillingSource: BillingSourcePerformanceBreakdown[];
  byJobType: JobTypePerformanceBreakdown[];
  byProject: ProjectPerformanceBreakdown[];
  insights: PerformanceInsight[];
}

interface UsageEventForTrend {
  modelName: string;
  billingSource: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCents: number | null;
  latencyMs: number | null;
  createdAt: Date;
  projectId: string | null;
  project: { id: string; title: string; slug: string } | null;
  providerId: string | null;
  provider: { name: string } | null;
  generationJob: { jobType: string } | null;
}

interface AggregateBucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  latencies: number[];
}

export function normalizePerformanceTrendWindow(value: unknown): PerformanceTrendWindow | null {
  return value === "7d" || value === "30d" ? value : null;
}

export async function getPerformanceTrends(params: {
  prisma: PrismaClient;
  organizationId: string;
  projectId?: string;
  window: PerformanceTrendWindow;
  now?: Date;
}): Promise<PerformanceTrends> {
  const days = params.window === "7d" ? 7 : 30;
  const end = startOfUtcDay(params.now ?? new Date());
  const start = addUtcDays(end, -(days - 1));
  const events = await params.prisma.usageEvent.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      createdAt: { gte: start }
    },
    select: {
      modelName: true,
      billingSource: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostCents: true,
      latencyMs: true,
      createdAt: true,
      projectId: true,
      project: { select: { id: true, title: true, slug: true } },
      providerId: true,
      provider: { select: { name: true } },
      generationJob: { select: { jobType: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  return aggregateEvents({
    events: events as UsageEventForTrend[],
    scope: params.projectId ? "project" : "organization",
    window: params.window,
    days,
    start
  });
}

function aggregateEvents(params: {
  events: UsageEventForTrend[];
  scope: "project" | "organization";
  window: PerformanceTrendWindow;
  days: number;
  start: Date;
}): PerformanceTrends {
  const dailyBuckets = initializeDailyBuckets(params.start, params.days);
  const modelBuckets = new Map<string, AggregateBucket>();
  const providerBuckets = new Map<string, AggregateBucket & { providerId: string | null; providerName: string | null }>();
  const billingBuckets = new Map<string, AggregateBucket>();
  const jobTypeBuckets = new Map<string, AggregateBucket>();
  const projectBuckets = new Map<string, AggregateBucket & { projectId: string | null; projectTitle: string; projectSlug: string | null }>();
  const allLatencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostCents = 0;
  let hasCost = false;

  for (const event of params.events) {
    const totalTokens = event.inputTokens + event.outputTokens;
    const latency = typeof event.latencyMs === "number" ? event.latencyMs : null;
    inputTokens += event.inputTokens;
    outputTokens += event.outputTokens;
    if (typeof event.estimatedCostCents === "number") {
      estimatedCostCents += event.estimatedCostCents;
      hasCost = true;
    }
    if (latency !== null) allLatencies.push(latency);

    addToBucket(dailyBuckets.get(toDateKey(event.createdAt)), event.inputTokens, event.outputTokens, latency);
    addToBucket(getBucket(modelBuckets, event.modelName), event.inputTokens, event.outputTokens, latency);

    const providerKey = event.providerId ?? "__unknown__";
    const providerBucket = getBucket(providerBuckets, providerKey, {
      providerId: event.providerId,
      providerName: event.provider?.name ?? null
    });
    addToBucket(providerBucket, event.inputTokens, event.outputTokens, latency);

    addToBucket(getBucket(billingBuckets, event.billingSource), event.inputTokens, event.outputTokens, latency);
    addToBucket(getBucket(jobTypeBuckets, event.generationJob?.jobType ?? "UNKNOWN"), event.inputTokens, event.outputTokens, latency);
    const projectKey = event.projectId ?? "__unknown_project__";
    const projectBucket = getBucket(projectBuckets, projectKey, {
      projectId: event.projectId,
      projectTitle: event.project?.title ?? "未关联项目",
      projectSlug: event.project?.slug ?? null
    });
    addToBucket(projectBucket, event.inputTokens, event.outputTokens, latency);

    // Keep totalTokens local to the loop for readability around distribution math.
    void totalTokens;
  }

  const totals: PerformanceTrendTotals = {
    calls: params.events.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencySamples: allLatencies.length,
    averageLatencyMs: average(allLatencies),
    p50LatencyMs: percentileNearestRank(allLatencies, 50),
    p95LatencyMs: percentileNearestRank(allLatencies, 95),
    estimatedCostCents: hasCost ? estimatedCostCents : null
  };
  const byProject = sortBreakdown(
    Array.from(projectBuckets.values()).map((bucket) => ({
      projectId: bucket.projectId,
      projectTitle: bucket.projectTitle,
      projectSlug: bucket.projectSlug,
      calls: bucket.calls,
      totalTokens: bucket.inputTokens + bucket.outputTokens,
      averageLatencyMs: average(bucket.latencies),
      p95LatencyMs: percentileNearestRank(bucket.latencies, 95)
    }))
  );

  return {
    scope: params.scope,
    window: params.window,
    totals,
    daily: Array.from(dailyBuckets.entries()).map(([date, bucket]) => ({
      date,
      calls: bucket.calls,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      averageLatencyMs: average(bucket.latencies)
    })),
    byModel: sortBreakdown(
      Array.from(modelBuckets.entries()).map(([modelName, bucket]) => ({
        modelName,
        calls: bucket.calls,
        totalTokens: bucket.inputTokens + bucket.outputTokens,
        averageLatencyMs: average(bucket.latencies)
      }))
    ),
    byProvider: sortBreakdown(
      Array.from(providerBuckets.values()).map((bucket) => ({
        providerId: bucket.providerId,
        providerName: bucket.providerName,
        calls: bucket.calls,
        totalTokens: bucket.inputTokens + bucket.outputTokens
      }))
    ),
    byBillingSource: sortBreakdown(
      Array.from(billingBuckets.entries()).map(([billingSource, bucket]) => ({
        billingSource,
        calls: bucket.calls,
        totalTokens: bucket.inputTokens + bucket.outputTokens
      }))
    ),
    byJobType: sortBreakdown(
      Array.from(jobTypeBuckets.entries()).map(([jobType, bucket]) => ({
        jobType,
        calls: bucket.calls,
        totalTokens: bucket.inputTokens + bucket.outputTokens
      }))
    ),
    byProject,
    insights: buildInsights(totals, byProject)
  };
}

function buildInsights(totals: PerformanceTrendTotals, byProject: ProjectPerformanceBreakdown[]): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];

  if (totals.calls === 0) {
    insights.push({
      id: "no_data",
      severity: "info",
      category: "data",
      title: "暂无性能数据",
      detail: "当前时间窗口还没有模型调用记录。"
    });
    return insights;
  }

  if (totals.estimatedCostCents === null) {
    insights.push({
      id: "missing_cost_data",
      severity: "info",
      category: "cost",
      title: "缺少成本数据",
      detail: "已有调用记录，但没有可汇总的成本字段；成本视图会暂时不完整。"
    });
  }

  const slowProject = byProject.find((project) => (project.p95LatencyMs ?? 0) >= 15_000);
  if (slowProject) {
    const p95 = slowProject.p95LatencyMs ?? 0;
    insights.push({
      id: "high_latency_project",
      severity: p95 >= 30_000 ? "critical" : "warning",
      category: "latency",
      title: "项目延迟偏高",
      detail: `${slowProject.projectTitle} 的 P95 延迟已明显偏高，建议检查模型、上下文预算或生成模式。`,
      targetProjectId: slowProject.projectId,
      targetProjectTitle: slowProject.projectTitle,
      metricLabel: `P95 ${p95}ms`
    });
  }

  const heavyTokenProject = byProject.find((project) => project.totalTokens >= 50_000);
  if (heavyTokenProject) {
    insights.push({
      id: "high_token_project",
      severity: heavyTokenProject.totalTokens >= 150_000 ? "critical" : "warning",
      category: "tokens",
      title: "项目 token 消耗偏高",
      detail: `${heavyTokenProject.projectTitle} 在当前窗口消耗较多 tokens，建议关注上下文裁剪和 deep 模式使用频率。`,
      targetProjectId: heavyTokenProject.projectId,
      targetProjectTitle: heavyTokenProject.projectTitle,
      metricLabel: `${heavyTokenProject.totalTokens} tokens`
    });
  }

  const topProject = byProject[0];
  if (topProject && totals.calls >= 3 && topProject.calls / totals.calls >= 0.6) {
    insights.push({
      id: "concentrated_usage",
      severity: "warning",
      category: "usage",
      title: "调用集中在单一项目",
      detail: `${topProject.projectTitle} 占用了大部分调用量，组织级趋势可能主要由它驱动。`,
      targetProjectId: topProject.projectId,
      targetProjectTitle: topProject.projectTitle,
      metricLabel: `${topProject.calls}/${totals.calls} 次`
    });
  }

  return sortInsights(insights).slice(0, 5);
}

function sortInsights(insights: PerformanceInsight[]): PerformanceInsight[] {
  const weight: Record<PerformanceInsight["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2
  };
  return [...insights].sort((a, b) => weight[a.severity] - weight[b.severity]);
}

function initializeDailyBuckets(start: Date, days: number): Map<string, AggregateBucket> {
  const buckets = new Map<string, AggregateBucket>();
  for (let offset = 0; offset < days; offset += 1) {
    buckets.set(toDateKey(addUtcDays(start, offset)), emptyBucket());
  }
  return buckets;
}

function getBucket<T extends AggregateBucket>(
  buckets: Map<string, T>,
  key: string,
  extra?: Omit<T, keyof AggregateBucket>
): T {
  const existing = buckets.get(key);
  if (existing) return existing;
  const bucket = { ...emptyBucket(), ...(extra ?? {}) } as T;
  buckets.set(key, bucket);
  return bucket;
}

function emptyBucket(): AggregateBucket {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencies: []
  };
}

function addToBucket(bucket: AggregateBucket | undefined, inputTokens: number, outputTokens: number, latency: number | null): void {
  if (!bucket) return;
  bucket.calls += 1;
  bucket.inputTokens += inputTokens;
  bucket.outputTokens += outputTokens;
  if (latency !== null) bucket.latencies.push(latency);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? null;
}

function sortBreakdown<T extends { calls: number; totalTokens: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.calls - a.calls || b.totalTokens - a.totalTokens);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
