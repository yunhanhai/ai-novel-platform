import { beforeEach, describe, expect, it, vi } from "vitest";

const retryMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../server/audit-log", () => ({ recordAuditLog: auditMock }));
vi.mock("@ai-novel/db", () => ({
  retryFailedJob: retryMock,
  prisma: {
    $transaction: transactionMock,
    generationJob: {
      findFirst: vi.fn()
    }
  }
}));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  requireSession: sessionMock,
  isUnauthorizedError: (error: Error) => error.name === "UnauthorizedError"
}));

import { GET, POST } from "./route";
import { prisma } from "@ai-novel/db";

function p() { return prisma as unknown as { generationJob: { findFirst: ReturnType<typeof vi.fn> } }; }
function routeCtx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("GET /api/generation-jobs/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns job with steps and prompt snapshots (200)", async () => {
    p().generationJob.findFirst.mockResolvedValue({
      id: "job-1", jobType: "GENERATE_CHAPTER", status: "SUCCEEDED",
      progress: "100", targetEntityType: "CHAPTER", targetEntityId: "ch-1",
      errorCode: null, errorMessage: null, output: { chapterId: "ch-1" },
      startedAt: new Date(), finishedAt: new Date(), createdAt: new Date(),
      steps: [{ id: "step-1", stepKey: "plan", status: "SUCCEEDED", outputPreview: "preview", promptSnapshot: "prompt snapshot",
        inputTokens: 100, outputTokens: 50, latencyMs: 200, errorMessage: null,
        startedAt: new Date(), finishedAt: new Date() }]
    });
    const res = await GET(new Request("http://localhost/api/generation-jobs/job-1"), routeCtx("job-1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.id).toBe("job-1");
    expect(body.data.steps).toHaveLength(1);
    expect(body.data.steps[0].promptSnapshot).toBe("prompt snapshot");
    expect(p().generationJob.findFirst.mock.calls[0]?.[0].select.steps.select.promptSnapshot).toBe(true);
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
describe("POST /api/generation-jobs/[id] retry", () => {
  const tx = { generationJob: {}, auditLog: {} };
  const req = (body: unknown) => new Request("http://localhost/api/generation-jobs/job-1", { method: "POST", body: JSON.stringify(body) });
  beforeEach(() => { vi.resetAllMocks(); sessionMock.mockResolvedValue({ organizationId: "session-org", userId: "session-user" }); transactionMock.mockImplementation((cb) => cb(tx)); retryMock.mockResolvedValue({ ok: true, job: { id: "job-1", status: "QUEUED" } }); });
  it("retries and audits in one transaction under session identity", async () => { const response = await POST(req({ action: "retry", organizationId: "forged" }), routeCtx("job-1")); expect(response.status).toBe(200); expect(retryMock).toHaveBeenCalledWith({ prisma: tx, organizationId: "session-org", jobId: "job-1" }); expect(auditMock).toHaveBeenCalledWith({ prisma: tx, organizationId: "session-org", actorUserId: "session-user", action: "generation_job.retry", entityType: "generation_job", entityId: "job-1", metadata: { resultingStatus: "QUEUED" } }); });
  it("returns 404 for foreign jobs without audit", async () => { retryMock.mockResolvedValue({ ok: false, reason: "not_found" }); expect((await POST(req({ action: "retry" }), routeCtx("foreign"))).status).toBe(404); expect(auditMock).not.toHaveBeenCalled(); });
  it("returns 409 for a job no longer FAILED", async () => { retryMock.mockResolvedValue({ ok: false, reason: "invalid_status" }); expect((await POST(req({ action: "retry" }), routeCtx("job-1"))).status).toBe(409); expect(auditMock).not.toHaveBeenCalled(); });
  it("requires a valid session before trying mutation", async () => { sessionMock.mockRejectedValue(Object.assign(new Error("expired"), { name: "UnauthorizedError" })); expect((await POST(req({ action: "retry" }), routeCtx("job-1"))).status).toBe(401); expect(transactionMock).not.toHaveBeenCalled(); });
  it("fails transaction if audit cannot persist", async () => { auditMock.mockRejectedValue(new Error("postgres private details")); const response = await POST(req({ action: "retry" }), routeCtx("job-1")); expect(response.status).toBe(500); expect((await response.json()).error).toBe("服务器内部错误"); });
  it("rejects malformed request bodies", async () => { expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }), routeCtx("job-1"))).status).toBe(400); expect(transactionMock).not.toHaveBeenCalled(); });
});