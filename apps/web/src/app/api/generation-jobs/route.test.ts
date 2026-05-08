import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findChapter: vi.fn(),
  createJob: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({
  prisma: {
    chapter: { findFirst: mocks.findChapter },
    generationJob: { findMany: vi.fn() }
  },
  createJob: mocks.createJob
}));

describe("/api/generation-jobs POST", () => {
  beforeEach(() => {
    process.env.DEFAULT_ORGANIZATION_ID = "org-test";
    process.env.DEFAULT_USER_ID = "user-test";
    mocks.findChapter.mockReset();
    mocks.createJob.mockReset();
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORGANIZATION_ID;
    delete process.env.DEFAULT_USER_ID;
  });

  it("rejects unknown jobType", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/generation-jobs", {
      method: "POST",
      body: JSON.stringify({ chapterId: "c1", jobType: "BOGUS" })
    }));
    expect(res.status).toBe(400);
  });

  it("requires chapterId or projectId", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/generation-jobs", {
      method: "POST",
      body: JSON.stringify({})
    }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when chapter not found", async () => {
    mocks.findChapter.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/generation-jobs", {
      method: "POST",
      body: JSON.stringify({ chapterId: "c-missing" })
    }));
    expect(res.status).toBe(404);
  });

  it("creates job for valid chapter", async () => {
    mocks.findChapter.mockResolvedValue({ id: "c1", projectId: "p1" });
    mocks.createJob.mockResolvedValue({
      id: "job-1", jobType: "GENERATE_CHAPTER", status: "QUEUED", projectId: "p1"
    });

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/generation-jobs", {
      method: "POST",
      body: JSON.stringify({ chapterId: "c1" })
    }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data).toMatchObject({ id: "job-1", projectId: "p1", chapterId: "c1" });
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-test",
      userId: "user-test",
      projectId: "p1",
      jobType: "GENERATE_CHAPTER",
      targetEntityType: "CHAPTER",
      targetEntityId: "c1"
    }));
  });
});
