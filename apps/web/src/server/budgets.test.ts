import { describe, expect, it, vi } from "vitest";
import {
  acknowledgeBudgetNotification,
  calculateBudgetPeriod,
  getBudgetDashboard,
  normalizeThresholdPercents,
  upsertBudgetPolicy,
  type BudgetPrismaClient
} from "./budgets";

const now = new Date("2026-05-20T12:00:00.000Z");
const policy = {
  id: "policy-1",
  organizationId: "org-1",
  projectId: null,
  monthlyBudgetCents: 10_000,
  monthlyTokenQuota: 20_000,
  cycleAnchorDay: 15,
  thresholdPercents: [50, 80, 100],
  isActive: true,
  createdAt: now,
  updatedAt: now
};

const notification = {
  id: "note-1",
  organizationId: "org-1",
  projectId: null,
  budgetPolicyId: "policy-1",
  dedupeKey: "policy-1:2026-05-15:50",
  periodStart: new Date("2026-05-15T00:00:00.000Z"),
  periodEnd: new Date("2026-06-14T00:00:00.000Z"),
  thresholdPercent: 50,
  actualCostCents: 6_200,
  budgetCents: 10_000,
  actualTokens: 4_500,
  tokenQuota: 20_000,
  status: "open",
  message: "本周期预算使用率已达到 50%。",
  createdAt: now,
  acknowledgedAt: null
};

function mockPrisma(overrides: Partial<BudgetPrismaClient> = {}): BudgetPrismaClient {
  return {
    organizationBudgetPolicy: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn()
    },
    usageEvent: {
      findMany: vi.fn().mockResolvedValue([])
    },
    budgetNotification: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn()
    },
    ...overrides
  };
}

describe("budget services", () => {
  describe("calculateBudgetPeriod", () => {
    it("uses the current month anchor when today is after the anchor day", () => {
      const period = calculateBudgetPeriod(new Date("2026-05-20T22:10:00.000Z"), 15);

      expect(period.periodStart.toISOString()).toBe("2026-05-15T00:00:00.000Z");
      expect(period.periodEnd.toISOString()).toBe("2026-06-14T00:00:00.000Z");
      expect(period.periodEndExclusive.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    });

    it("uses the previous month anchor when today is before the anchor day", () => {
      const period = calculateBudgetPeriod(new Date("2026-05-08T09:00:00.000Z"), 15);

      expect(period.periodStart.toISOString()).toBe("2026-04-15T00:00:00.000Z");
      expect(period.periodEnd.toISOString()).toBe("2026-05-14T00:00:00.000Z");
      expect(period.periodEndExclusive.toISOString()).toBe("2026-05-15T00:00:00.000Z");
    });

    it("rejects anchor days outside the supported 1-28 range", () => {
      expect(() => calculateBudgetPeriod(now, 29)).toThrow("cycleAnchorDay 超出允许范围");
    });
  });

  describe("normalizeThresholdPercents", () => {
    it("normalizes, deduplicates and sorts threshold values", () => {
      expect(normalizeThresholdPercents([80, "50.4", 80, 0, 501, "abc", 100])).toEqual([50, 80, 100]);
    });

    it("accepts comma-separated strings and object levels", () => {
      expect(normalizeThresholdPercents("100, 50, 80")).toEqual([50, 80, 100]);
      expect(normalizeThresholdPercents({ levels: [120, 60] })).toEqual([60, 120]);
    });

    it("falls back to default thresholds when no valid value exists", () => {
      expect(normalizeThresholdPercents([0, "abc"])).toEqual([50, 80, 100]);
      expect(normalizeThresholdPercents(undefined)).toEqual([50, 80, 100]);
    });
  });

  describe("upsertBudgetPolicy", () => {
    it("creates an active organization policy when none exists", async () => {
      const create = vi.fn().mockResolvedValue(policy);
      const prisma = mockPrisma({
        organizationBudgetPolicy: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create
        }
      });

      const result = await upsertBudgetPolicy({
        organizationId: "org-1",
        monthlyBudgetCents: 10_000,
        monthlyTokenQuota: 20_000,
        cycleAnchorDay: 15,
        thresholdPercents: "50,80,100",
        prisma
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          projectId: null,
          monthlyBudgetCents: 10_000,
          monthlyTokenQuota: 20_000,
          cycleAnchorDay: 15,
          thresholdPercents: [50, 80, 100]
        })
      });
      expect(result.thresholdPercents).toEqual([50, 80, 100]);
    });

    it("updates the existing scoped policy", async () => {
      const update = vi.fn().mockResolvedValue({ ...policy, monthlyBudgetCents: 12_000, projectId: "proj-1" });
      const prisma = mockPrisma({
        organizationBudgetPolicy: {
          findFirst: vi.fn().mockResolvedValue({ ...policy, projectId: "proj-1" }),
          update,
          create: vi.fn()
        }
      });

      await upsertBudgetPolicy({
        organizationId: "org-1",
        projectId: "proj-1",
        monthlyBudgetCents: 12_000,
        monthlyTokenQuota: 20_000,
        cycleAnchorDay: 15,
        thresholdPercents: [80],
        prisma
      });

      expect(update).toHaveBeenCalledWith({
        where: { id: "policy-1" },
        data: expect.objectContaining({ monthlyBudgetCents: 12_000, thresholdPercents: [80] })
      });
    });
  });

  describe("getBudgetDashboard", () => {
    it("aggregates usage for the active budget period and emits crossed-threshold notifications", async () => {
      const findPolicy = vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(policy);
      const usageFindMany = vi.fn().mockResolvedValue([
        {
          createdAt: new Date("2026-05-15T10:00:00.000Z"),
          inputTokens: 1_000,
          outputTokens: 500,
          estimatedCostCents: 2_000
        },
        {
          createdAt: new Date("2026-05-16T12:30:00.000Z"),
          inputTokens: 2_000,
          outputTokens: 1_000,
          estimatedCostCents: 4_200
        }
      ]);
      const upsert = vi.fn().mockResolvedValue(notification);
      const listNotifications = vi.fn().mockResolvedValue([notification]);
      const prisma = mockPrisma({
        organizationBudgetPolicy: {
          findFirst: findPolicy,
          update: vi.fn(),
          create: vi.fn()
        },
        usageEvent: { findMany: usageFindMany },
        budgetNotification: {
          findMany: listNotifications,
          updateMany: vi.fn(),
          findFirst: vi.fn(),
          upsert
        }
      });

      const dashboard = await getBudgetDashboard({
        organizationId: "org-1",
        projectId: "proj-1",
        now: new Date("2026-05-20T12:00:00.000Z"),
        prisma
      });

      expect(findPolicy).toHaveBeenNthCalledWith(1, {
        where: { organizationId: "org-1", projectId: "proj-1", isActive: true },
        orderBy: { updatedAt: "desc" }
      });
      expect(findPolicy).toHaveBeenNthCalledWith(2, {
        where: { organizationId: "org-1", projectId: null, isActive: true },
        orderBy: { updatedAt: "desc" }
      });
      expect(usageFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          projectId: "proj-1",
          createdAt: {
            gte: new Date("2026-05-15T00:00:00.000Z"),
            lt: new Date("2026-06-15T00:00:00.000Z")
          }
        })
      }));
      expect(dashboard.summary.actualCostCents).toBe(6_200);
      expect(dashboard.summary.costUsagePercent).toBe(62);
      expect(dashboard.summary.actualTokens).toBe(4_500);
      expect(dashboard.dailyUsage.find((point) => point.date === "2026-05-16")).toMatchObject({
        costCents: 4_200,
        tokens: 3_000
      });
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { dedupeKey: "policy-1:2026-05-15:50" },
        create: expect.objectContaining({ thresholdPercent: 50, actualCostCents: 6_200 })
      }));
      expect(dashboard.notifications).toHaveLength(1);
    });
  });

  describe("acknowledgeBudgetNotification", () => {
    it("marks an open notification as acknowledged within the organization scope", async () => {
      const acknowledged = { ...notification, status: "acknowledged", acknowledgedAt: now };
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const findFirst = vi.fn().mockResolvedValue(acknowledged);
      const prisma = mockPrisma({
        budgetNotification: {
          findMany: vi.fn(),
          updateMany,
          findFirst,
          upsert: vi.fn()
        }
      });

      const result = await acknowledgeBudgetNotification({ organizationId: "org-1", id: "note-1", prisma });

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "note-1", organizationId: "org-1", status: "open" },
        data: { status: "acknowledged", acknowledgedAt: expect.any(Date) }
      });
      expect(findFirst).toHaveBeenCalledWith({ where: { id: "note-1", organizationId: "org-1" } });
      expect(result.status).toBe("acknowledged");
    });

    it("throws when the notification is missing or already handled", async () => {
      const prisma = mockPrisma({
        budgetNotification: {
          findMany: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findFirst: vi.fn(),
          upsert: vi.fn()
        }
      });

      await expect(acknowledgeBudgetNotification({ organizationId: "org-1", id: "note-1", prisma }))
        .rejects.toThrow("预算通知不存在或已处理");
    });
  });
});
