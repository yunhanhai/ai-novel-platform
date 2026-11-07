import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", async importOriginal => ({
  JobRequestConflict: (await importOriginal<typeof import("@ai-novel/db")>()).JobRequestConflict,
  prisma: {
    generationJob: { findMany: vi.fn() },
    chapter: { findFirst: vi.fn() },
    project: { findFirst: vi.fn().mockResolvedValue({ id: "proj-1" }) }
  },
  createJob: vi.fn()
}));

vi.mock("../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  getUserId: async () => "user-1",
  isUnauthorizedError: () => false
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

  it("returns 400 for an unknown jobType", async () => {
    const res = await POST(req({ chapterId: "ch-1", jobType: "NOT_A_JOB" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("jobType");
  });

  it("creates a GENERATE_OUTLINE job at project level", async () => {
    cj().mockResolvedValue({ id: "job-1", jobType: "GENERATE_OUTLINE", status: "QUEUED", projectId: "proj-1" });
    const res = await POST(req({ projectId: "proj-1", jobType: "GENERATE_OUTLINE", input: { chapterCount: 3 } }));
    expect(res.status).toBe(201);
    expect(cj()).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "GENERATE_OUTLINE",
      projectId: "proj-1"
    }));
  });

  it("creates a REVIEW job", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
    cj().mockResolvedValue({ id: "job-1", jobType: "REVIEW", status: "QUEUED", projectId: "proj-1" });
    const res = await POST(req({ chapterId: "ch-1", jobType: "REVIEW" }));
    expect(res.status).toBe(201);
    expect(cj()).toHaveBeenCalledWith(expect.objectContaining({ jobType: "REVIEW" }));
  });

  it("returns 400 when REWRITE has no selectedText", async () => {
    const res = await POST(req({ chapterId: "ch-1", jobType: "REWRITE" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("selectedText");
  });

  it("returns 400 when POLISH selectedText is blank", async () => {
    const res = await POST(req({ chapterId: "ch-1", jobType: "POLISH", input: { selectedText: "   " } }));
    expect(res.status).toBe(400);
  });

  it("creates a POLISH job and stores selectedText in input", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
    cj().mockResolvedValue({
      id: "job-1", jobType: "POLISH", status: "QUEUED", projectId: "proj-1"
    });
    const res = await POST(req({
      chapterId: "ch-1",
      jobType: "POLISH",
      input: { selectedText: "她坐在窗边，头也不抬。", instruction: "更口语化" }
    }));
    expect(res.status).toBe(201);
    expect(cj()).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "POLISH",
      input: expect.objectContaining({
        selectedText: "她坐在窗边，头也不抬。",
        instruction: "更口语化"
      })
    }));
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

  it("stores contextOptions in job input", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
    cj().mockResolvedValue({
      id: "job-1", jobType: "GENERATE_CHAPTER", status: "QUEUED", projectId: "proj-1"
    });

    const res = await POST(req({
      chapterId: "ch-1",
      jobType: "GENERATE_CHAPTER",
      input: { draftMode: "chapter" },
      contextOptions: { budgetPreset: "compact", excludedAssetIds: ["ch2"], forcedAssetIds: ["w1"] }
    }));

    expect(res.status).toBe(201);
    expect(cj()).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        draftMode: "chapter",
        contextOptions: expect.objectContaining({
          budgetPreset: "compact",
          excludedAssetIds: ["ch2"],
          forcedAssetIds: ["w1"]
        })
      })
    }));
  });

  it("stores normalized quality mode and clamped performance budget", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
    cj().mockResolvedValue({ id: "job-1", jobType: "GENERATE_CHAPTER", status: "QUEUED", projectId: "proj-1" });

    const res = await POST(req({
      chapterId: "ch-1",
      jobType: "GENERATE_CHAPTER",
      qualityMode: "fast",
      performanceBudget: { maxModelCalls: 99 }
    }));

    expect(res.status).toBe(201);
    expect(cj()).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        qualityMode: "fast",
        performanceBudget: expect.objectContaining({ maxModelCalls: 12 })
      })
    }));
  });

  it("rejects an explicit invalid quality mode", async () => {
    const res = await POST(req({ chapterId: "ch-1", qualityMode: "slow" }));
    expect(res.status).toBe(400);
  });

  it("requires a chapter target for diagnostic jobs", async () => {
    const res = await POST(req({ projectId: "proj-1", jobType: "DIAGNOSE_CHAPTER" }));
    expect(res.status).toBe(400);
  });
});

it("rejects reversed chapter length bounds before creating a job",async()=>{
  const res=await POST(new Request("http://localhost/api/generation-jobs",{method:"POST",body:JSON.stringify({chapterId:"ch-1",jobType:"GENERATE_CHAPTER",input:{qualityConstraints:{minChars:900,maxChars:700}}})}));
  expect(res.status).toBe(400);
});

it("rejects invalid request receipts before creating a job", async () => {
  const response = await POST(new Request("http://localhost/api/generation-jobs", { method: "POST", body: JSON.stringify({ chapterId: "ch-1", requestId: "invalid" }) }));
  expect(response.status).toBe(400);
});
it("passes a request receipt and returns a completed job result intact", async () => {
  p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
  cj().mockResolvedValue({ id: "job-1", jobType: "POLISH", status: "SUCCEEDED", projectId: "proj-1", progress: "100", output: { newText: "完整候选" }, errorMessage: null, startedAt: "start", finishedAt: "finish" });
  const response = await POST(new Request("http://localhost/api/generation-jobs", { method: "POST", body: JSON.stringify({ chapterId: "ch-1", jobType: "POLISH", input: { selectedText: "原文" }, requestId: "10000000-0000-4000-8000-000000000001" }) }));
  expect(response.status).toBe(201);
  expect((await response.json()).data).toMatchObject({ status: "SUCCEEDED", progress: "100", output: { newText: "完整候选" }, finishedAt: "finish" });
  expect(cj()).toHaveBeenCalledWith(expect.objectContaining({ requestId: "10000000-0000-4000-8000-000000000001" }));
});
it("maps a reused request with different parameters to409", async () => {
  const { JobRequestConflict } = await import("@ai-novel/db");
  p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" }); cj().mockRejectedValueOnce(new JobRequestConflict());
  const response = await POST(new Request("http://localhost/api/generation-jobs", { method: "POST", body: JSON.stringify({ chapterId: "ch-1" }) }));
  expect(response.status).toBe(409);
});

it("rejects foreign project targets before creating a receipt", async () => {
  const project = prisma as unknown as { project: { findFirst: ReturnType<typeof vi.fn> } };
  project.project.findFirst.mockResolvedValueOnce(null);
  const response = await POST(new Request("http://localhost/api/generation-jobs", { method: "POST", body: JSON.stringify({ projectId: "foreign", jobType: "GENERATE_OUTLINE" }) }));
  expect(response.status).toBe(404);
  expect(project.project.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", organizationId: "org-1", deletedAt: null }, select: { id: true } });
});
