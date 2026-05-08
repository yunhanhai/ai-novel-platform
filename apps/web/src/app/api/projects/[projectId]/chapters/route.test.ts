import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findChaptersByProject: vi.fn(),
  createChapter: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../../server/chapters", () => ({
  findChaptersByProject: mocks.findChaptersByProject,
  createChapter: mocks.createChapter
}));

function makeContext(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe("/api/projects/[projectId]/chapters", () => {
  beforeEach(() => {
    process.env.DEFAULT_ORGANIZATION_ID = "org-test";
    process.env.DEFAULT_USER_ID = "user-test";
    mocks.findChaptersByProject.mockReset();
    mocks.createChapter.mockReset();
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORGANIZATION_ID;
    delete process.env.DEFAULT_USER_ID;
  });

  it("GET returns chapter list with serialized fields", async () => {
    mocks.findChaptersByProject.mockResolvedValue([
      {
        id: "c1", chapterNo: 1, title: "第一章", status: "DRAFT",
        wordCount: 0, content: "", updatedAt: new Date("2026-04-29")
      }
    ]);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/x"), makeContext("p1"));
    const json = await res.json();
    expect(json.data[0]).toMatchObject({ id: "c1", chapterNo: 1, title: "第一章" });
    expect(mocks.findChaptersByProject).toHaveBeenCalledWith("org-test", "p1", expect.any(Object));
  });

  it("POST rejects invalid chapterNo", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ chapterNo: 0, title: "x" })
      }),
      makeContext("p1")
    );
    expect(res.status).toBe(400);
  });

  it("POST creates chapter and returns 201", async () => {
    mocks.createChapter.mockResolvedValue({ id: "c2", chapterNo: 2, title: "第二章" });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ chapterNo: 2, title: "第二章" })
      }),
      makeContext("p1")
    );
    expect(res.status).toBe(201);
    expect(mocks.createChapter).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-test",
      createdById: "user-test",
      projectId: "p1",
      chapterNo: 2
    }));
  });
});
