import type { Prisma } from "@ai-novel/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLDS = [50, 80, 100];

export interface BudgetPrismaClient {
  organizationBudgetPolicy: {
    findFirst(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  usageEvent: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  budgetNotification: {
    findMany(args: unknown): Promise<unknown[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
    findFirst(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface BudgetPolicyInput {
  projectId?: string | null;
  monthlyBudgetCents: number;
  monthlyTokenQuota: number;
  cycleAnchorDay: number;
  thresholdPercents?: unknown;
}

export interface BudgetPeriod {
  periodStart: Date;
  periodEnd: Date;
  periodEndExclusive: Date;
}

export interface BudgetUsagePoint {
  date: string;
  costCents: number;
  tokens: number;
}

export interface BudgetPolicyDto {
  id: string;
  organizationId: string;
  projectId: string | null;
  monthlyBudgetCents: number;
  monthlyTokenQuota: number;
  cycleAnchorDay: number;
  thresholdPercents: number[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetNotificationDto {
  id: string;
  organizationId: string;
  projectId: string | null;
  budgetPolicyId: string | null;
  dedupeKey: string;
  periodStart: Date;
  periodEnd: Date;
  thresholdPercent: number;
  actualCostCents: number;
  budgetCents: number;
  actualTokens: number;
  tokenQuota: number;
  status: string;
  message: string | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export interface BudgetDashboard {
  policy: BudgetPolicyDto | null;
  period: BudgetPeriod;
  summary: {
    actualCostCents: number;
    budgetCents: number;
    remainingBudgetCents: number | null;
    costUsagePercent: number | null;
    actualTokens: number;
    tokenQuota: number;
    remainingTokens: number | null;
    tokenUsagePercent: number | null;
    maxUsagePercent: number;
  };
  dailyUsage: BudgetUsagePoint[];
  notifications: BudgetNotificationDto[];
}

interface BudgetPolicyRecord {
  id: string;
  organizationId: string;
  projectId: string | null;
  monthlyBudgetCents: number;
  monthlyTokenQuota: number;
  cycleAnchorDay: number;
  thresholdPercents: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface BudgetNotificationRecord {
  id: string;
  organizationId: string;
  projectId: string | null;
  budgetPolicyId: string | null;
  dedupeKey: string;
  periodStart: Date;
  periodEnd: Date;
  thresholdPercent: number;
  actualCostCents: number;
  budgetCents: number;
  actualTokens: number;
  tokenQuota: number;
  status: string;
  message: string | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export function calculateBudgetPeriod(now: Date, cycleAnchorDay: number): BudgetPeriod {
  const anchorDay = clampInteger(cycleAnchorDay, 1, 28, "cycleAnchorDay");
  const current = utcDateOnly(now);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const thisAnchor = new Date(Date.UTC(year, month, anchorDay));
  const periodStart = current >= thisAnchor
    ? thisAnchor
    : new Date(Date.UTC(year, month - 1, anchorDay));
  const periodEndExclusive = new Date(Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth() + 1,
    anchorDay
  ));
  const periodEnd = new Date(periodEndExclusive.getTime() - MS_PER_DAY);

  return { periodStart, periodEnd, periodEndExclusive };
}

export function normalizeThresholdPercents(value: unknown): number[] {
  const raw = extractThresholdArray(value);
  if (!raw) return [...DEFAULT_THRESHOLDS];

  const values = raw
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.round(item))
    .filter((item) => item > 0 && item <= 500);
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...DEFAULT_THRESHOLDS];
}

export async function upsertBudgetPolicy(params: BudgetPolicyInput & {
  organizationId: string;
  prisma: BudgetPrismaClient;
}) {
  const { organizationId, prisma } = params;
  const projectId = normalizeProjectId(params.projectId);
  const data = {
    monthlyBudgetCents: clampInteger(params.monthlyBudgetCents, 0, Number.MAX_SAFE_INTEGER, "monthlyBudgetCents"),
    monthlyTokenQuota: clampInteger(params.monthlyTokenQuota, 0, Number.MAX_SAFE_INTEGER, "monthlyTokenQuota"),
    cycleAnchorDay: clampInteger(params.cycleAnchorDay, 1, 28, "cycleAnchorDay"),
    thresholdPercents: normalizeThresholdPercents(params.thresholdPercents) as Prisma.InputJsonValue
  };

  const existing = await prisma.organizationBudgetPolicy.findFirst({
    where: { organizationId, projectId, isActive: true }
  }) as BudgetPolicyRecord | null;

  const policy = existing
    ? await prisma.organizationBudgetPolicy.update({ where: { id: existing.id }, data })
    : await prisma.organizationBudgetPolicy.create({
      data: { organizationId, projectId, ...data }
    });

  return toBudgetPolicyDto(policy as BudgetPolicyRecord);
}

export async function getBudgetDashboard(params: {
  organizationId: string;
  projectId?: string | null;
  now?: Date;
  prisma: BudgetPrismaClient;
}): Promise<BudgetDashboard> {
  const { organizationId, prisma } = params;
  const projectId = normalizeProjectId(params.projectId);
  const policy = await resolveBudgetPolicy(organizationId, projectId, prisma);
  const period = calculateBudgetPeriod(params.now ?? new Date(), policy?.cycleAnchorDay ?? 1);
  const dailyUsage = await aggregateUsageEvents({ organizationId, projectId, period, prisma });
  const actualCostCents = dailyUsage.reduce((sum, point) => sum + point.costCents, 0);
  const actualTokens = dailyUsage.reduce((sum, point) => sum + point.tokens, 0);
  const budgetCents = policy?.monthlyBudgetCents ?? 0;
  const tokenQuota = policy?.monthlyTokenQuota ?? 0;
  const costUsagePercent = usagePercent(actualCostCents, budgetCents);
  const tokenUsagePercent = usagePercent(actualTokens, tokenQuota);
  const summary = {
    actualCostCents,
    budgetCents,
    remainingBudgetCents: budgetCents > 0 ? Math.max(0, budgetCents - actualCostCents) : null,
    costUsagePercent,
    actualTokens,
    tokenQuota,
    remainingTokens: tokenQuota > 0 ? Math.max(0, tokenQuota - actualTokens) : null,
    tokenUsagePercent,
    maxUsagePercent: Math.max(costUsagePercent ?? 0, tokenUsagePercent ?? 0)
  };

  if (policy) {
    await refreshBudgetNotifications({ organizationId, policy, period, summary, prisma });
  }

  const notifications = await listBudgetNotifications({ organizationId, status: "open", limit: 8, prisma });

  return {
    policy: policy ? toBudgetPolicyDto(policy) : null,
    period,
    summary,
    dailyUsage,
    notifications
  };
}

export async function listBudgetNotifications(params: {
  organizationId: string;
  status?: "open" | "acknowledged";
  limit?: number;
  prisma: BudgetPrismaClient;
}) {
  const take = clampInteger(params.limit ?? 20, 1, 50, "limit");
  const items = await params.prisma.budgetNotification.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.status ? { status: params.status } : {})
    },
    orderBy: { createdAt: "desc" },
    take
  });

  return (items as BudgetNotificationRecord[]).map(toBudgetNotificationDto);
}

export async function acknowledgeBudgetNotification(params: {
  organizationId: string;
  id: string;
  prisma: BudgetPrismaClient;
}) {
  const result = await params.prisma.budgetNotification.updateMany({
    where: { id: params.id, organizationId: params.organizationId, status: "open" },
    data: { status: "acknowledged", acknowledgedAt: new Date() }
  });
  if (result.count === 0) {
    throw new Error("预算通知不存在或已处理");
  }

  const item = await params.prisma.budgetNotification.findFirst({
    where: { id: params.id, organizationId: params.organizationId }
  });
  if (!item) throw new Error("预算通知不存在");
  return toBudgetNotificationDto(item as BudgetNotificationRecord);
}

async function resolveBudgetPolicy(
  organizationId: string,
  projectId: string | null,
  prisma: BudgetPrismaClient
): Promise<BudgetPolicyRecord | null> {
  if (projectId) {
    const projectPolicy = await prisma.organizationBudgetPolicy.findFirst({
      where: { organizationId, projectId, isActive: true },
      orderBy: { updatedAt: "desc" }
    });
    if (projectPolicy) return projectPolicy as BudgetPolicyRecord;
  }

  const organizationPolicy = await prisma.organizationBudgetPolicy.findFirst({
    where: { organizationId, projectId: null, isActive: true },
    orderBy: { updatedAt: "desc" }
  });
  return organizationPolicy as BudgetPolicyRecord | null;
}

async function aggregateUsageEvents(params: {
  organizationId: string;
  projectId: string | null;
  period: BudgetPeriod;
  prisma: BudgetPrismaClient;
}) {
  const days = Math.max(1, Math.ceil(
    (params.period.periodEndExclusive.getTime() - params.period.periodStart.getTime()) / MS_PER_DAY
  ));
  const points = Array.from({ length: days }, (_item, index) => {
    const date = new Date(params.period.periodStart.getTime() + index * MS_PER_DAY);
    return { date: toDateKey(date), costCents: 0, tokens: 0 };
  });
  const indexByDate = new Map(points.map((point, index) => [point.date, index]));

  const events = await params.prisma.usageEvent.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      createdAt: { gte: params.period.periodStart, lt: params.period.periodEndExclusive }
    },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostCents: true
    }
  });

  for (const event of events as Array<{
    createdAt: Date;
    inputTokens: number;
    outputTokens: number;
    estimatedCostCents: number | null;
  }>) {
    const index = indexByDate.get(toDateKey(event.createdAt));
    if (index === undefined) continue;
    const point = points[index]!;
    point.costCents += Math.max(0, event.estimatedCostCents ?? 0);
    point.tokens += Math.max(0, event.inputTokens + event.outputTokens);
  }

  return points;
}

async function refreshBudgetNotifications(params: {
  organizationId: string;
  policy: BudgetPolicyRecord;
  period: BudgetPeriod;
  summary: BudgetDashboard["summary"];
  prisma: BudgetPrismaClient;
}) {
  if (params.summary.maxUsagePercent <= 0) return [];

  const thresholds = normalizeThresholdPercents(params.policy.thresholdPercents)
    .filter((threshold) => params.summary.maxUsagePercent >= threshold);
  const periodStartKey = toDateKey(params.period.periodStart);

  return Promise.all(thresholds.map((threshold) => {
    const dedupeKey = `${params.policy.id}:${periodStartKey}:${threshold}`;
    const message = buildNotificationMessage(threshold, params.summary);
    return params.prisma.budgetNotification.upsert({
      where: { dedupeKey },
      create: {
        organizationId: params.organizationId,
        projectId: params.policy.projectId,
        budgetPolicyId: params.policy.id,
        dedupeKey,
        periodStart: params.period.periodStart,
        periodEnd: params.period.periodEnd,
        thresholdPercent: threshold,
        actualCostCents: params.summary.actualCostCents,
        budgetCents: params.summary.budgetCents,
        actualTokens: params.summary.actualTokens,
        tokenQuota: params.summary.tokenQuota,
        message
      },
      update: {
        actualCostCents: params.summary.actualCostCents,
        budgetCents: params.summary.budgetCents,
        actualTokens: params.summary.actualTokens,
        tokenQuota: params.summary.tokenQuota,
        message
      }
    });
  }));
}

function toBudgetPolicyDto(policy: BudgetPolicyRecord): BudgetPolicyDto {
  return {
    id: policy.id,
    organizationId: policy.organizationId,
    projectId: policy.projectId,
    monthlyBudgetCents: policy.monthlyBudgetCents,
    monthlyTokenQuota: policy.monthlyTokenQuota,
    cycleAnchorDay: policy.cycleAnchorDay,
    thresholdPercents: normalizeThresholdPercents(policy.thresholdPercents),
    isActive: policy.isActive,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt
  };
}

function toBudgetNotificationDto(item: BudgetNotificationRecord): BudgetNotificationDto {
  return {
    id: item.id,
    organizationId: item.organizationId,
    projectId: item.projectId,
    budgetPolicyId: item.budgetPolicyId,
    dedupeKey: item.dedupeKey,
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    thresholdPercent: item.thresholdPercent,
    actualCostCents: item.actualCostCents,
    budgetCents: item.budgetCents,
    actualTokens: item.actualTokens,
    tokenQuota: item.tokenQuota,
    status: item.status,
    message: item.message,
    createdAt: item.createdAt,
    acknowledgedAt: item.acknowledgedAt
  };
}

function extractThresholdArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",").map((item) => item.trim());
  if (value && typeof value === "object" && Array.isArray((value as { levels?: unknown }).levels)) {
    return (value as { levels: unknown[] }).levels;
  }
  return null;
}

function normalizeProjectId(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

function clampInteger(value: number, min: number, max: number, fieldName: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${fieldName} 必须是整数`);
  }
  if (value < min || value > max) {
    throw new Error(`${fieldName} 超出允许范围`);
  }
  return value;
}

function usagePercent(actual: number, quota: number): number | null {
  if (quota <= 0) return null;
  return Math.round((actual / quota) * 1000) / 10;
}

function utcDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildNotificationMessage(threshold: number, summary: BudgetDashboard["summary"]): string {
  const costPart = summary.budgetCents > 0
    ? `费用 ${formatCents(summary.actualCostCents)} / ${formatCents(summary.budgetCents)}`
    : "费用额度未设置";
  const tokenPart = summary.tokenQuota > 0
    ? `Token ${summary.actualTokens.toLocaleString("zh-CN")} / ${summary.tokenQuota.toLocaleString("zh-CN")}`
    : "Token 额度未设置";
  return `本周期预算使用率已达到 ${threshold}%。${costPart}，${tokenPart}。`;
}

function formatCents(value: number): string {
  return `¥${(value / 100).toFixed(2)}`;
}
