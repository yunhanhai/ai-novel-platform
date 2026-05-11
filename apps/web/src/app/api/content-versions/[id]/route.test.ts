import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    contentVersion: { findFirst: vi.fn() }
  }
}));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: () => "org-1",
  getUserId: () => "user-1"
}));

vi.mock("../../../../server/content-versions", () => ({
  getChapterVersion: vi.fn(),
  restoreChapterVersion: vi.fn()
}));

import { GET, POST } from "./route";
import { prisma } from "@ai-novel/db";
import { getChapterVersion, restoreChapterVersion } from "../../../../server/content-versions";

function p() { return prisma as unknown as { contentVersion: { findFirst: ReturnType<typeof vi.fn> } }; }
function gv() { return getChapterVersion as unknown as ReturnType<typeof vi.fn>; }
function rv() { return restoreChapterVersion as unknown as ReturnType<typeof vi.fn>; }
function routeCtx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("GET /api/content-versions/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns version detail (200)", async () => {
    gv().mockResolvedValue({
      id: "v-1", entityType: "CHAPTER", entityId: "ch-1",
      versionNo: 1, source: "AI", content: "正文内容", wordCount: 4,
      generationJobId: "job-1", createdById: "user-1", createdAt: new Date()
    });
    const res = await GET(new Request("http://localhost/api/content-versions/v-1"), routeCtx("v-1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when version not found", async () => {
    gv().mockRejectedValue(new Error("版本不存在"));
    const res = await GET(new Request("http://localhost/api/content-versions/v-1"), routeCtx("v-1"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/content-versions/[id] (restore)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("restores version and returns 200", async () => {
    rv().mockResolvedValue({ versionId: "v-1", chapterId: "ch-1" });
    const res = await POST(new Request("http://localhost/api/content-versions/v-1", {
      method: "POST", body: JSON.stringify({})
    }), routeCtx("v-1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when target version not found", async () => {
    rv().mockRejectedValue(new Error("版本不存在"));
    const res = await POST(new Request("http://localhost/api/content-versions/v-1", {
      method: "POST", body: JSON.stringify({})
    }), routeCtx("v-1"));
    expect(res.status).toBe(404);
  });
});
