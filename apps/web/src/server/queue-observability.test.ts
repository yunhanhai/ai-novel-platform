import { describe, expect, it, vi } from "vitest";
import { getQueueObservability } from "./queue-observability";

type JobRow = {
  id: string;
  jobType: string;
  status: string;
  projectId: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  project: { title: string; slug: string } | null;
};

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    jobType: "GENERATE_CHAPTER",
    status: "QUEUED",
    projectId: "project-1",
    targetEntityType: "CHAPTER",
    targetEntityId: "chapter-1",
    errorCode: null,
    errorMessage: null,
    createdAt: new Date("2026-05-28T09:58:00.000Z"),
    startedAt: null,
    finishedAt: null,
    project: { title: "Project One", slug: "project-one" },
    ...overrides
  };
}

function mockPrisma(params: {
  groups?: Array<{ status: string; _count: { _all: number } }>;
  oldestQueued?: JobRow | null;
  recentJobs?: JobRow[];
}) {
  return {
    generationJob: {
      groupBy: vi.fn().mockResolvedValue(params.groups ?? []),
      findFirst: vi.fn().mockResolvedValue(params.oldestQueued ?? null),
      findMany: vi.fn().mockResolvedValue(params.recentJobs ?? [])
    }
  } as unknown as Parameters<typeof getQueueObservability>[0]["prisma"];
}

describe("getQueueObservability", () => {
  it("returns idle totals for organizations without jobs", async () => {
    const prisma = mockPrisma({});

    const result = await getQueueObservability({
      prisma,
      organizationId: "org-1",
      now: new Date("2026-05-28T10:00:00.000Z")
    });

    expect(result.totals).toEqual({
      total: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0
    });
    expect(result.oldestQueued).toBeNull();
    expect(result.health.state).toBe("idle");
    expect(result.recentJobs).toEqual([]);
  });

  it("aggregates status counts and queued wait time", async () => {
    const prisma = mockPrisma({
      groups: [
        { status: "QUEUED", _count: { _all: 3 } },
        { status: "RUNNING", _count: { _all: 1 } },
        { status: "SUCCEEDED", _count: { _all: 8 } },
        { status: "FAILED", _count: { _all: 2 } }
      ],
      oldestQueued: job({ id: "old-job", createdAt: new Date("2026-05-28T09:55:00.000Z") }),
      recentJobs: [job({ id: "recent-job", status: "RUNNING", startedAt: new Date("2026-05-28T09:59:00.000Z") })]
    });

    const result = await getQueueObservability({
      prisma,
      organizationId: "org-1",
      now: new Date("2026-05-28T10:00:00.000Z")
    });

    expect(result.totals).toMatchObject({
      total: 14,
      queued: 3,
      running: 1,
      succeeded: 8,
      failed: 2,
      cancelled: 0
    });
    expect(result.oldestQueued).toMatchObject({
      id: "old-job",
      projectTitle: "Project One",
      waitMs: 300_000
    });
    expect(result.recentJobs).toEqual([
      expect.objectContaining({
        id: "recent-job",
        status: "RUNNING",
        projectTitle: "Project One"
      })
    ]);
    expect(result.health.state).toBe("attention");
  });

  it("marks queued backlog without failures separately from active work", async () => {
    const backlog = await getQueueObservability({
      prisma: mockPrisma({
        groups: [{ status: "QUEUED", _count: { _all: 2 } }],
        oldestQueued: job()
      }),
      organizationId: "org-1",
      now: new Date("2026-05-28T10:00:00.000Z")
    });
    const active = await getQueueObservability({
      prisma: mockPrisma({
        groups: [{ status: "RUNNING", _count: { _all: 1 } }]
      }),
      organizationId: "org-1",
      now: new Date("2026-05-28T10:00:00.000Z")
    });

    expect(backlog.health.state).toBe("backlog");
    expect(active.health.state).toBe("active");
  });

  it("queries only the current organization and limits recent jobs", async () => {
    const prisma = mockPrisma({});

    await getQueueObservability({
      prisma,
      organizationId: "org-1",
      now: new Date("2026-05-28T10:00:00.000Z")
    });

    expect(prisma.generationJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["status"],
      where: { organizationId: "org-1" },
      _count: { _all: true }
    }));
    expect(prisma.generationJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
      orderBy: { createdAt: "desc" },
      take: 8
    }));
  });
});
