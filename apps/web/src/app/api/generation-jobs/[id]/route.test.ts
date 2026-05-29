import { beforeEach, describe, expect, it, vi } from "vitest";

const retryFailedJobMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-novel/db", () => ({
  retryFailedJob: retryFailedJobMock,
  prisma: {
    generationJob: {
      findFirst: vi.fn()
    }
  }
}));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: () => "org-1"
}));

import { GET, POST } from "./route";
import { prisma } from "@ai-novel/db";

function p() { return prisma as unknown as { generationJob: { findFirst: ReturnType<typeof vi.fn> } }; }
function routeCtx(id: string) { return { params: Promise.resolve({ id }) }; }
function req(body: unknown) {
  return new Request("http://localhost/api/generation-jobs/job-1", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

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

  it("maps performance and diagnostic summaries from job output", async () => {
    p().generationJob.findFirst.mockResolvedValue({
      id: "job-2", jobType: "DIAGNOSE_CHAPTER", status: "SUCCEEDED",
      progress: "100", targetEntityType: "CHAPTER", targetEntityId: "ch-1",
      errorCode: null, errorMessage: null,
      output: {
        performanceSummary: { qualityMode: "balanced", modelCalls: 1, inputTokens: 10, outputTokens: 20, latencyMs: 30, skippedSteps: [] },
        diagnosticSummary: { readerScore: 88, abandonRisk: "low", hookStrength: 70, suggestions: ["keep hook"] }
      },
      startedAt: new Date(), finishedAt: new Date(), createdAt: new Date(),
      steps: []
    });

    const res = await GET(new Request("http://localhost/api/generation-jobs/job-2"), routeCtx("job-2"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.performanceSummary).toMatchObject({ modelCalls: 1 });
    expect(body.data.diagnosticSummary).toMatchObject({ readerScore: 88 });
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

describe("POST /api/generation-jobs/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("retries a failed job in the current organization", async () => {
    retryFailedJobMock.mockResolvedValue({
      ok: true,
      job: { id: "job-1", status: "QUEUED" }
    });

    const res = await POST(req({ action: "retry" }), routeCtx("job-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: "job-1", status: "QUEUED" });
    expect(retryFailedJobMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      jobId: "job-1",
      prisma
    });
  });

  it("returns 404 when retry target is not found in the organization", async () => {
    retryFailedJobMock.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await POST(req({ action: "retry" }), routeCtx("missing-job"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("returns 409 when retry target is not failed", async () => {
    retryFailedJobMock.mockResolvedValue({ ok: false, reason: "invalid_status", status: "RUNNING" });

    const res = await POST(req({ action: "retry" }), routeCtx("job-1"));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("RUNNING");
  });

  it("rejects unknown actions", async () => {
    const res = await POST(req({ action: "cancel" }), routeCtx("job-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(retryFailedJobMock).not.toHaveBeenCalled();
  });
});
