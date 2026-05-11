import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    generationJob: {
      findFirst: vi.fn()
    }
  }
}));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: () => "org-1"
}));

import { GET } from "./route";
import { prisma } from "@ai-novel/db";

function p() { return prisma as unknown as { generationJob: { findFirst: ReturnType<typeof vi.fn> } }; }
function routeCtx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("GET /api/generation-jobs/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns job with steps (200)", async () => {
    p().generationJob.findFirst.mockResolvedValue({
      id: "job-1", jobType: "GENERATE_CHAPTER", status: "SUCCEEDED",
      progress: "100", targetEntityType: "CHAPTER", targetEntityId: "ch-1",
      errorCode: null, errorMessage: null, output: { chapterId: "ch-1" },
      startedAt: new Date(), finishedAt: new Date(), createdAt: new Date(),
      steps: [{ id: "step-1", stepKey: "plan", status: "SUCCEEDED", outputPreview: "预览",
        inputTokens: 100, outputTokens: 50, latencyMs: 200, errorMessage: null,
        startedAt: new Date(), finishedAt: new Date() }]
    });
    const res = await GET(new Request("http://localhost/api/generation-jobs/job-1"), routeCtx("job-1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.id).toBe("job-1");
    expect(body.data.steps).toHaveLength(1);
  });

  it("returns 404 when job not found", async () => {
    p().generationJob.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/generation-jobs/nope"), routeCtx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns 500 on prisma error", async () => {
    p().generationJob.findFirst.mockRejectedValue(new Error("db error"));
    const res = await GET(new Request("http://localhost/api/generation-jobs/job-1"), routeCtx("job-1"));
    expect(res.status).toBe(500);
  });
});
