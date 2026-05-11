import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    generationJob: { findMany: vi.fn() },
    chapter: { findFirst: vi.fn() }
  },
  createJob: vi.fn()
}));

vi.mock("../../../server/context", () => ({
  getOrganizationId: () => "org-1",
  getUserId: () => "user-1"
}));

import { GET, POST } from "./route";
import { prisma, createJob } from "@ai-novel/db";

type MockPrisma = { generationJob: { findMany: ReturnType<typeof vi.fn> }; chapter: { findFirst: ReturnType<typeof vi.fn> } };

function p() { return prisma as unknown as MockPrisma; }
function cj() { return createJob as unknown as ReturnType<typeof vi.fn>; }

describe("GET /api/generation-jobs", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when no projectId or chapterId", async () => {
    const res = await GET(new Request("http://localhost/api/generation-jobs"));
    expect(res.status).toBe(400);
  });

  it("returns jobs filtered by projectId (200)", async () => {
    p().generationJob.findMany.mockResolvedValue([
      { id: "job-1", jobType: "GENERATE_CHAPTER", status: "QUEUED", progress: "0",
        errorCode: null, errorMessage: null, targetEntityType: "CHAPTER", targetEntityId: "ch-1",
        startedAt: null, finishedAt: null, createdAt: new Date() }
    ]);
    const res = await GET(new Request("http://localhost/api/generation-jobs?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/generation-jobs", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/generation-jobs", { method: "POST", body: JSON.stringify(body) });
  }

  it("returns 400 when jobType is invalid", async () => {
    const res = await POST(req({ projectId: "proj-1", jobType: "INVALID" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when both chapterId and projectId missing", async () => {
    const res = await POST(req({ jobType: "GENERATE_CHAPTER" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when chapterId does not exist", async () => {
    p().chapter.findFirst.mockResolvedValue(null);
    const res = await POST(req({ chapterId: "nonexistent", jobType: "GENERATE_CHAPTER" }));
    expect(res.status).toBe(404);
  });

  it("creates job and returns 201", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
    cj().mockResolvedValue({
      id: "job-1", jobType: "GENERATE_CHAPTER", status: "QUEUED", projectId: "proj-1"
    });
    const res = await POST(req({ chapterId: "ch-1", jobType: "GENERATE_CHAPTER" }));
    expect(res.status).toBe(201);
  });
});
