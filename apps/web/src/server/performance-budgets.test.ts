import { describe, expect, it, vi } from "vitest";
import {
  deactivatePerformanceBudget,
  getEffectivePerformanceCostBudget,
  listPerformanceBudgets,
  normalizePerformanceBudgetInput,
  upsertPerformanceBudget
} from "./performance-budgets";

type MockPrisma = {
  performanceBudget: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function mockPrisma(overrides: Partial<MockPrisma> = {}): MockPrisma {
  return {
    performanceBudget: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as MockPrisma;
}

describe("performance-budgets", () => {
  it("normalizes positive thresholds and permits absent values", () => {
    expect(normalizePerformanceBudgetInput({
      warningCents: "500",
      criticalCents: 1000
    })).toEqual({
      warningCents: 500,
      criticalCents: 1000
    });

    expect(normalizePerformanceBudgetInput({
      warningCents: null,
      criticalCents: undefined
    })).toEqual({
      warningCents: null,
      criticalCents: null
    });
  });

  it("lists budgets for an organization", async () => {
    const prisma = mockPrisma({
      performanceBudget: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }
    });

    await listPerformanceBudgets("org-1", prisma as unknown as Parameters<typeof listPerformanceBudgets>[1]);

    expect(prisma.performanceBudget.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", isActive: true },
      orderBy: [{ scope: "asc" }, { projectId: "asc" }]
    });
  });

  it("upserts an organization budget", async () => {
    const prisma = mockPrisma({
      performanceBudget: { findMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "budget-1" }), update: vi.fn() }
    });

    await upsertPerformanceBudget({
      organizationId: "org-1",
      scope: "ORGANIZATION",
      warningCents: 500,
      criticalCents: 1000,
      prisma: prisma as unknown as Parameters<typeof upsertPerformanceBudget>[0]["prisma"]
    });

    expect(prisma.performanceBudget.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          scope: "ORGANIZATION",
          projectId: null
        })
      })
    );
  });

  it("deactivates an active budget for a scope", async () => {
    const prisma = mockPrisma({
      performanceBudget: {
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ id: "budget-1" }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "budget-1", isActive: false })
      }
    });

    const result = await deactivatePerformanceBudget({
      organizationId: "org-1",
      scope: "PROJECT",
      projectId: "proj-1",
      prisma: prisma as unknown as Parameters<typeof deactivatePerformanceBudget>[0]["prisma"]
    });

    expect(result).toEqual({ id: "budget-1", isActive: false });
    expect(prisma.performanceBudget.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        scope: "PROJECT",
        projectId: "proj-1",
        isActive: true
      },
      select: { id: true }
    });
    expect(prisma.performanceBudget.update).toHaveBeenCalledWith({
      where: { id: "budget-1", organizationId: "org-1", scope: "PROJECT", projectId: "proj-1", isActive: true },
      data: { isActive: false, updatedAt: expect.any(Date) }
    });
  });

  it("returns null when deactivating a missing budget", async () => {
    const prisma = mockPrisma({
      performanceBudget: {
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn()
      }
    });

    const result = await deactivatePerformanceBudget({
      organizationId: "org-1",
      scope: "ORGANIZATION",
      prisma: prisma as unknown as Parameters<typeof deactivatePerformanceBudget>[0]["prisma"]
    });

    expect(result).toBeNull();
    expect(prisma.performanceBudget.update).not.toHaveBeenCalled();
  });

  it("resolves the project override before the organization budget", async () => {
    const prisma = mockPrisma({
      performanceBudget: {
        findMany: vi.fn(),
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            scope: "PROJECT",
            warningCents: 700,
            criticalCents: 900
          })
          .mockResolvedValueOnce({
            scope: "ORGANIZATION",
            warningCents: 400,
            criticalCents: 800
          }),
        create: vi.fn(),
        update: vi.fn()
      }
    });

    const result = await getEffectivePerformanceCostBudget({
      organizationId: "org-1",
      projectId: "proj-1",
      prisma: prisma as unknown as Parameters<typeof getEffectivePerformanceCostBudget>[0]["prisma"]
    });

    expect(result).toEqual({
      scope: "PROJECT",
      warningCents: 700,
      criticalCents: 900
    });
    expect(prisma.performanceBudget.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        scope: "PROJECT",
        isActive: true
      })
    }));
    expect(prisma.performanceBudget.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        projectId: null,
        scope: "ORGANIZATION",
        isActive: true
      })
    }));
  });
});

describe("budget input boundary", () => {
  it.each([1.5, "12junk", "1.2", -1, 0, 2147483648, {}, true])("rejects malformed threshold %j", (value) => {
    expect(() => normalizePerformanceBudgetInput({ warningCents: value })).toThrow();
  });
  it("rejects reversed thresholds", () => {
    expect(() => normalizePerformanceBudgetInput({ warningCents: 1000, criticalCents: 500 })).toThrow();
  });
});
describe("budget write concurrency", () => {
  it("updates the winning active budget after a concurrent create", async () => {
    const prisma = mockPrisma();
    prisma.performanceBudget.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner" });
    prisma.performanceBudget.create.mockRejectedValueOnce({ code: "P2002" });
    prisma.performanceBudget.update.mockResolvedValueOnce({ id: "winner", warningCents: 500 });
    await expect(upsertPerformanceBudget({ organizationId: "org-1", scope: "ORGANIZATION", warningCents: 500, prisma: prisma as never })).resolves.toMatchObject({ id: "winner" });
    expect(prisma.performanceBudget.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "winner", organizationId: "org-1", isActive: true }) }));
  });
});
it("makes simultaneous clear idempotent when another request already deactivated the row", async () => {
  const prisma = mockPrisma();
  prisma.performanceBudget.findFirst.mockResolvedValue({ id: "budget" });
  prisma.performanceBudget.update.mockRejectedValue({ code: "P2025" });
  await expect(deactivatePerformanceBudget({ organizationId: "org-1", scope: "ORGANIZATION", prisma: prisma as never })).resolves.toBeNull();
});