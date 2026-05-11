import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    chapter: { findFirst: vi.fn() },
    contentVersion: { findFirst: vi.fn(), create: vi.fn() }
  }
}));

vi.mock("@ai-novel/shared/generation/word-count", () => ({
  computeWordCount: () => 42
}));

vi.mock("../../../server/context", () => ({
  getOrganizationId: () => "org-1",
  getUserId: () => "user-1"
}));

import { POST } from "./route";
import { prisma } from "@ai-novel/db";

function p() { return prisma as unknown as {
  chapter: { findFirst: ReturnType<typeof vi.fn> };
  contentVersion: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
}; }

describe("POST /api/content-versions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/content-versions", {
      method: "POST", body: JSON.stringify(body)
    });
  }

  it("returns 400 when chapterId or content missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when chapter not found", async () => {
    p().chapter.findFirst.mockResolvedValue(null);
    const res = await POST(req({ chapterId: "ch-none", content: "test" }));
    expect(res.status).toBe(404);
  });

  it("creates version and returns 201", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
    p().contentVersion.findFirst.mockResolvedValue(null); // no prior versions
    p().contentVersion.create.mockResolvedValue({ id: "v-new", versionNo: 1 });
    const res = await POST(req({ chapterId: "ch-1", content: "备份正文" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.versionNo).toBe(1);
  });

  it("computes nextVersionNo correctly", async () => {
    p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
    p().contentVersion.findFirst.mockResolvedValue({ versionNo: 5 });
    p().contentVersion.create.mockResolvedValue({ id: "v-6", versionNo: 6 });
    const res = await POST(req({ chapterId: "ch-1", content: "正文" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.versionNo).toBe(6);
  });
});
