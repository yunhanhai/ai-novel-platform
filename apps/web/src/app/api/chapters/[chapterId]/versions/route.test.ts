import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    contentVersion: { findMany: vi.fn() }
  }
}));

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: () => "org-1"
}));

import { GET } from "./route";
import { prisma } from "@ai-novel/db";

function p() { return prisma as unknown as { contentVersion: { findMany: ReturnType<typeof vi.fn> } }; }
function routeCtx(chapterId: string) {
  return { params: Promise.resolve({ chapterId }) };
}

describe("GET /api/chapters/[chapterId]/versions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns version list (200)", async () => {
    p().contentVersion.findMany.mockResolvedValue([
      { id: "v-1", versionNo: 1, source: "MANUAL", content: "内容".repeat(100),
        wordCount: 200, createdById: "user-1", generationJobId: null,
        createdAt: new Date() }
    ]);
    const res = await GET(new Request("http://localhost/api/chapters/ch-1/versions"), routeCtx("ch-1"));
    expect(res.status).toBe(200);
  });

  it("returns 500 on error", async () => {
    p().contentVersion.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("http://localhost/api/chapters/ch-1/versions"), routeCtx("ch-1"));
    expect(res.status).toBe(500);
  });
});
