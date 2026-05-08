import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findChapter: vi.fn(),
  updateChapter: vi.fn(),
  findUniqueChapter: vi.fn(),
  updateChapterContent: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({
  prisma: {
    chapter: {
      findFirst: mocks.findChapter,
      findUnique: mocks.findUniqueChapter,
      update: mocks.updateChapter
    }
  }
}));
vi.mock("../../../../server/chapters", () => ({
  updateChapterContent: mocks.updateChapterContent
}));

function makeContext(chapterId: string) {
  return { params: Promise.resolve({ chapterId }) };
}

describe("/api/chapters/[chapterId]", () => {
  beforeEach(() => {
    process.env.DEFAULT_ORGANIZATION_ID = "org-test";
    process.env.DEFAULT_USER_ID = "user-test";
    mocks.findChapter.mockReset();
    mocks.updateChapter.mockReset();
    mocks.findUniqueChapter.mockReset();
    mocks.updateChapterContent.mockReset();
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORGANIZATION_ID;
    delete process.env.DEFAULT_USER_ID;
  });

  it("PATCH returns 404 when chapter not found", async () => {
    mocks.findChapter.mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({ content: "abc" })
      }),
      makeContext("c-missing")
    );
    expect(res.status).toBe(404);
  });

  it("PATCH content uses Chinese-aware word count", async () => {
    mocks.findChapter.mockResolvedValue({ id: "c1" });
    mocks.updateChapterContent.mockResolvedValue({});
    mocks.findUniqueChapter.mockResolvedValue({ id: "c1", content: "你好 world" });

    const { PATCH } = await import("./route");
    await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({ content: "你好 world" })
      }),
      makeContext("c1")
    );

    expect(mocks.updateChapterContent).toHaveBeenCalledWith(
      expect.objectContaining({ chapterId: "c1", wordCount: 3 })   // 你 好 + world = 3
    );
  });
});
