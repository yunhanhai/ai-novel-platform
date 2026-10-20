import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    chapter: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock("@ai-novel/shared/generation/word-count", () => ({
  computeWordCount: (text: string) => [...text].length
}));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  getUserId: async () => "user-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../../server/chapters", () => ({
  updateChapterContent: vi.fn().mockResolvedValue({})
}));

import { GET, PATCH } from "./route";
import { prisma } from "@ai-novel/db";

function p() { return prisma as unknown as { chapter: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } }; }

function routeCtx(id: string) {
  return { params: Promise.resolve({ chapterId: id }) };
}

describe("GET /api/chapters/[chapterId]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns chapter (200)", async () => {
    p().chapter.findFirst.mockResolvedValue({
      id: "ch-1", projectId: "proj-1", chapterNo: 1, title: "第一章",
      status: "DRAFT", wordCount: 100, content: "正文...", updatedAt: new Date()
    });
    const res = await GET(new Request("http://localhost/api/chapters/ch-1"), routeCtx("ch-1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.title).toBe("第一章");
  });

  it("returns 404 when chapter not found", async () => {
    p().chapter.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/chapters/ch-1"), routeCtx("ch-1"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/chapters/[chapterId]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/chapters/ch-1", { method: "PATCH", body: JSON.stringify(body) });
  }

  it("updates chapter content and returns updated chapter (200)", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1" });
    p().chapter.findUnique.mockResolvedValue({
      id: "ch-1", projectId: "proj-1", chapterNo: 1, title: "第一章",
      status: "DRAFT", wordCount: 5, content: "abcde", updatedAt: new Date()
    });
    const res = await PATCH(req({ content: "abcde" }), routeCtx("ch-1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when patching non-existent chapter", async () => {
    p().chapter.findFirst.mockResolvedValue(null);
    const res = await PATCH(req({ content: "x" }), routeCtx("ch-1"));
    expect(res.status).toBe(404);
  });
});
