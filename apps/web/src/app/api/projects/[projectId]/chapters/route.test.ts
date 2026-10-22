import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    chapter: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), count: vi.fn() }
  }
}));

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  getUserId: async () => "user-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../../../server/chapters", () => ({
  createChapter: vi.fn(),
  findChaptersByProject: vi.fn()
}));

import { GET, POST } from "./route";
import { prisma } from "@ai-novel/db";
import { createChapter, findChaptersByProject } from "../../../../../server/chapters";

function p() { return prisma as unknown as { chapter: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> } }; }
function cc() { return createChapter as unknown as ReturnType<typeof vi.fn>; }
function fcp() { return findChaptersByProject as unknown as ReturnType<typeof vi.fn>; }
function routeCtx(projectId: string) { return { params: Promise.resolve({ projectId }) }; }

describe("GET /api/projects/[projectId]/chapters", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns chapters with word counts (200)", async () => {
    fcp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/projects/proj-1/chapters"), routeCtx("proj-1"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/projects/[projectId]/chapters", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/projects/proj-1/chapters", {
      method: "POST", body: JSON.stringify(body)
    });
  }

  it("creates chapter and returns 201", async () => {
    cc().mockResolvedValue({
      id: "ch-new", projectId: "proj-1", chapterNo: 1, title: "新章节",
      status: "PLANNED", wordCount: 0, content: null
    });
    const res = await POST(req({ title: "新章节", chapterNo: 1 }), routeCtx("proj-1"));
    expect(res.status).toBe(201);
  });

  it("returns 400 when title missing", async () => {
    const res = await POST(req({}), routeCtx("proj-1"));
    expect(res.status).toBe(400);
  });

  it("computes the next chapter number from the database when omitted", async () => {
    // 前端只加载了分页后的章节，序号必须由服务端按全量数据决定
    p().chapter.findFirst.mockResolvedValue({ chapterNo: 57 });
    cc().mockResolvedValue({
      id: "ch-new", projectId: "proj-1", chapterNo: 58, title: "新章节",
      status: "PLANNED", wordCount: 0, content: null
    });

    const res = await POST(req({ title: "新章节" }), routeCtx("proj-1"));

    expect(res.status).toBe(201);
    expect(p().chapter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { chapterNo: "desc" } })
    );
    expect(cc()).toHaveBeenCalledWith(expect.objectContaining({ chapterNo: 58 }));
  });

  it("starts at chapter 1 for the first chapter", async () => {
    p().chapter.findFirst.mockResolvedValue(null);
    cc().mockResolvedValue({
      id: "ch-1", projectId: "proj-1", chapterNo: 1, title: "首章",
      status: "PLANNED", wordCount: 0, content: null
    });

    await POST(req({ title: "首章" }), routeCtx("proj-1"));

    expect(cc()).toHaveBeenCalledWith(expect.objectContaining({ chapterNo: 1 }));
  });

  it("rejects a non-positive explicit chapter number", async () => {
    const res = await POST(req({ title: "章节", chapterNo: 0 }), routeCtx("proj-1"));
    expect(res.status).toBe(400);
    expect(cc()).not.toHaveBeenCalled();
  });

  it("counts soft-deleted chapters when deriving the next number", async () => {
    // 唯一索引 (project_id, chapter_no) 不区分 deleted_at：
    // 若只按未删除章节取最大值，删掉最后一章后会算回同一序号并撞约束。
    p().chapter.findFirst.mockResolvedValue({ chapterNo: 9 });
    cc().mockResolvedValue({
      id: "ch-new", projectId: "proj-1", chapterNo: 10, title: "新章节",
      status: "PLANNED", wordCount: 0, content: null
    });

    await POST(req({ title: "新章节" }), routeCtx("proj-1"));

    const args = p().chapter.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where.deletedAt).toBeUndefined();
    expect(cc()).toHaveBeenCalledWith(expect.objectContaining({ chapterNo: 10 }));
  });
});
