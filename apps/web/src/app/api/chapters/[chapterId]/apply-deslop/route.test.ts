import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {}
}));

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: () => "org-1",
  getUserId: () => "user-1"
}));

vi.mock("../../../../../server/chapters", () => ({
  applyDeslopEdit: vi.fn()
}));

import { POST } from "./route";
import { applyDeslopEdit } from "../../../../../server/chapters";

function ade() { return applyDeslopEdit as unknown as ReturnType<typeof vi.fn>; }
function routeCtx(chapterId: string) { return { params: Promise.resolve({ chapterId }) }; }
function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/chapters/ch-1/apply-deslop", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("POST /api/chapters/[chapterId]/apply-deslop", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("applies a deslop edit and returns the updated chapter/version", async () => {
    ade().mockResolvedValue({
      chapter: { id: "ch-1", content: "Everything stopped.", wordCount: 2 },
      version: { id: "cv-4", versionNo: 4 }
    });

    const res = await POST(req({
      nextContent: "Everything stopped.",
      baseContentHash: "a".repeat(64),
      matchedText: "almost",
      category: "stock_phrase"
    }), routeCtx("ch-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.version.versionNo).toBe(4);
    expect(ade()).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      chapterId: "ch-1",
      nextContent: "Everything stopped.",
      baseContentHash: "a".repeat(64),
      updatedById: "user-1",
      matchedText: "almost",
      category: "stock_phrase"
    }));
  });

  it("returns 400 when nextContent is missing", async () => {
    const res = await POST(req({ baseContentHash: "a".repeat(64), matchedText: "almost" }), routeCtx("ch-1"));

    expect(res.status).toBe(400);
    expect(ade()).not.toHaveBeenCalled();
  });

  it("returns 400 when baseContentHash is missing", async () => {
    const res = await POST(req({ nextContent: "x" }), routeCtx("ch-1"));

    expect(res.status).toBe(400);
    expect(ade()).not.toHaveBeenCalled();
  });

  it("returns 409 when the base content hash is stale", async () => {
    ade().mockRejectedValue(new Error("CHAPTER_CONTENT_STALE"));

    const res = await POST(req({ nextContent: "x", baseContentHash: "a".repeat(64) }), routeCtx("ch-1"));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("重新扫描");
  });

  it("returns 404 when the chapter does not exist", async () => {
    ade().mockRejectedValue(new Error("chapter not found"));

    const res = await POST(req({ nextContent: "x", baseContentHash: "a".repeat(64) }), routeCtx("missing"));

    expect(res.status).toBe(404);
  });
});
