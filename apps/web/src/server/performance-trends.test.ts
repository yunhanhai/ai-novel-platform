import { describe, expect, it, vi } from "vitest";
import { getPerformanceTrends } from "./performance-trends";

type UsageEventRow = {
  modelName: string;
  billingSource: "USER_KEY" | "PLATFORM";
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
};

function event(overrides: Partial<UsageEventRow> = {}): UsageEventRow {
  return {
    modelName: "gpt-test",
    billingSource: "USER_KEY",
    inputTokens: 100,
    outputTokens: 40,
    estimatedCostCents: 3,
    latencyMs: 1000,
    createdAt: new Date("2026-05-25T10:00:00.000Z"),
    projectId: "project-1",
    project: { id: "project-1", title: "Project One", slug: "project-one" },
    providerId: "provider-1",
    provider: { name: "OpenAI" },
    generationJob: { jobType: "GENERATE_CHAPTER" },
    ...overrides
  };
}

type MockPrisma = {
  usageEvent: {
    findMany: ReturnType<typeof vi.fn>;
  };
} & Parameters<typeof getPerformanceTrends>[0]["prisma"];

function mockPrisma(events: UsageEventRow[]): MockPrisma {
  return {
    usageEvent: {
      findMany: vi.fn().mockResolvedValue(events)
    }
  } as unknown as MockPrisma;
}

describe("getPerformanceTrends", () => {
  it("returns zero totals with filled daily buckets for empty project data", async () => {
    const prisma = mockPrisma([]);

    const result = await getPerformanceTrends({
      prisma,
      organizationId: "org-1",
      projectId: "proj-1",
      window: "7d",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    expect(result.scope).toBe("project");
    expect(result.window).toBe("7d");
    expect(result.daily).toHaveLength(7);
    expect(result.daily[0]).toMatchObject({ date: "2026-05-19", calls: 0 });
    expect(result.daily[6]).toMatchObject({ date: "2026-05-25", calls: 0 });
    expect(result.totals).toMatchObject({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencySamples: 0,
      averageLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
      estimatedCostCents: null
    });
  });

  it("filters by organization and project for project scope", async () => {
    const prisma = mockPrisma([]);

    await getPerformanceTrends({
      prisma,
      organizationId: "org-1",
      projectId: "proj-1",
      window: "30d",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    expect(prisma.usageEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          projectId: "proj-1"
        })
      })
    );
  });

  it("omits project filter for organization scope", async () => {
    const prisma = mockPrisma([]);

    const result = await getPerformanceTrends({
      prisma,
      organizationId: "org-1",
      window: "30d",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    const args = prisma.usageEvent.findMany.mock.calls[0]?.[0];
    expect(result.scope).toBe("organization");
    expect(args.where).not.toHaveProperty("projectId");
  });

  it("aggregates totals, daily buckets, and latency percentiles", async () => {
    const prisma = mockPrisma([
      event({
        inputTokens: 100,
        outputTokens: 20,
        latencyMs: 100,
        estimatedCostCents: 2,
        createdAt: new Date("2026-05-24T23:00:00.000Z")
      }),
      event({
        inputTokens: 200,
        outputTokens: 30,
        latencyMs: 300,
        estimatedCostCents: 4,
        createdAt: new Date("2026-05-25T01:00:00.000Z")
      }),
      event({
        inputTokens: 300,
        outputTokens: 40,
        latencyMs: null,
        estimatedCostCents: null,
        createdAt: new Date("2026-05-25T11:00:00.000Z")
      })
    ]);

    const result = await getPerformanceTrends({
      prisma,
      organizationId: "org-1",
      projectId: "proj-1",
      window: "7d",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    expect(result.totals).toMatchObject({
      calls: 3,
      inputTokens: 600,
      outputTokens: 90,
      totalTokens: 690,
      latencySamples: 2,
      averageLatencyMs: 200,
      p50LatencyMs: 100,
      p95LatencyMs: 300,
      estimatedCostCents: 6
    });
    expect(result.daily.find((day) => day.date === "2026-05-24")).toMatchObject({
      calls: 1,
      inputTokens: 100,
      outputTokens: 20,
      averageLatencyMs: 100
    });
    expect(result.daily.find((day) => day.date === "2026-05-25")).toMatchObject({
      calls: 2,
      inputTokens: 500,
      outputTokens: 70,
      averageLatencyMs: 300
    });
  });

  it("aggregates distributions by model, provider, billing source, and job type", async () => {
    const prisma = mockPrisma([
      event({ modelName: "gpt-a", providerId: "provider-a", provider: { name: "Provider A" }, billingSource: "USER_KEY" }),
      event({ modelName: "gpt-a", providerId: "provider-a", provider: { name: "Provider A" }, billingSource: "PLATFORM", generationJob: { jobType: "DIAGNOSE_CHAPTER" } }),
      event({ modelName: "gpt-b", providerId: null, provider: null, billingSource: "USER_KEY", generationJob: null })
    ]);

    const result = await getPerformanceTrends({
      prisma,
      organizationId: "org-1",
      projectId: "proj-1",
      window: "7d",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    expect(result.byModel).toEqual([
      expect.objectContaining({ modelName: "gpt-a", calls: 2, totalTokens: 280 }),
      expect.objectContaining({ modelName: "gpt-b", calls: 1, totalTokens: 140 })
    ]);
    expect(result.byProvider).toEqual([
      expect.objectContaining({ providerId: "provider-a", providerName: "Provider A", calls: 2, totalTokens: 280 }),
      expect.objectContaining({ providerId: null, providerName: null, calls: 1, totalTokens: 140 })
    ]);
    expect(result.byBillingSource).toEqual([
      expect.objectContaining({ billingSource: "USER_KEY", calls: 2, totalTokens: 280 }),
      expect.objectContaining({ billingSource: "PLATFORM", calls: 1, totalTokens: 140 })
    ]);
    expect(result.byJobType).toEqual([
      expect.objectContaining({ jobType: "GENERATE_CHAPTER", calls: 1, totalTokens: 140 }),
      expect.objectContaining({ jobType: "DIAGNOSE_CHAPTER", calls: 1, totalTokens: 140 }),
      expect.objectContaining({ jobType: "UNKNOWN", calls: 1, totalTokens: 140 })
    ]);
  });

  it("aggregates project rankings for organization trends", async () => {
    const prisma = mockPrisma([
      event({
        projectId: "project-a",
        project: { id: "project-a", title: "Project A", slug: "project-a" },
        inputTokens: 100,
        outputTokens: 20,
        latencyMs: 100
      }),
      event({
        projectId: "project-a",
        project: { id: "project-a", title: "Project A", slug: "project-a" },
        inputTokens: 300,
        outputTokens: 30,
        latencyMs: 500
      }),
      event({
        projectId: "project-b",
        project: { id: "project-b", title: "Project B", slug: "project-b" },
        inputTokens: 700,
        outputTokens: 40,
        latencyMs: null
      }),
      event({
        projectId: null,
        project: null,
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 50
      })
    ]);

    const result = await getPerformanceTrends({
      prisma,
      organizationId: "org-1",
      window: "7d",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    expect(result.byProject).toEqual([
      expect.objectContaining({
        projectId: "project-a",
        projectTitle: "Project A",
        projectSlug: "project-a",
        calls: 2,
        totalTokens: 450,
        averageLatencyMs: 300,
        p95LatencyMs: 500
      }),
      expect.objectContaining({
        projectId: "project-b",
        projectTitle: "Project B",
        projectSlug: "project-b",
        calls: 1,
        totalTokens: 740,
        averageLatencyMs: null,
        p95LatencyMs: null
      }),
      expect.objectContaining({
        projectId: null,
        projectTitle: "未关联项目",
        projectSlug: null,
        calls: 1,
        totalTokens: 15,
        averageLatencyMs: 50,
        p95LatencyMs: 50
      })
    ]);
  });

  it("keeps estimated cost null when all rows have null cost", async () => {
    const prisma = mockPrisma([
      event({ estimatedCostCents: null }),
      event({ estimatedCostCents: null })
    ]);

    const result = await getPerformanceTrends({
      prisma,
      organizationId: "org-1",
      window: "7d",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    expect(result.totals.estimatedCostCents).toBeNull();
  });
});
