import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("../../../../../../server/content-versions", () => ({
  getChapterVersion: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({
  prisma: { chapter: { findFirst: vi.fn() } }
}));

import { GET } from "./route";
import { getChapterVersion } from "../../../../../../server/content-versions";
import { prisma } from "@ai-novel/db";

function gv() {
  return getChapterVersion as unknown as ReturnType<typeof vi.fn>;
}
function pc() {
  return (prisma as unknown as { chapter: { findFirst: ReturnType<typeof vi.fn> } }).chapter;
}

function call(versionId?: string) {
  const url = versionId
    ? `http://localhost/api/chapters/ch-1/versions/diff?versionId=${versionId}`
    : "http://localhost/api/chapters/ch-1/versions/diff";
  return GET(new Request(url), { params: Promise.resolve({ chapterId: "ch-1" }) });
}

describe("GET /api/chapters/[chapterId]/versions/diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when versionId is missing", async () => {
    const res = await call();
    expect(res.status).toBe(400);
  });

  it("returns 404 when the version does not exist", async () => {
    gv().mockResolvedValue(null);
    pc().findFirst.mockResolvedValue({ id: "ch-1", content: "当前" });

    const res = await call("v-1");
    expect(res.status).toBe(404);
  });

  it("rejects a version belonging to another chapter", async () => {
    gv().mockResolvedValue({ id: "v-1", entityId: "ch-other", content: "旧" });
    pc().findFirst.mockResolvedValue({ id: "ch-1", content: "当前" });

    const res = await call("v-1");
    expect(res.status).toBe(400);
  });

  it("returns diff segments and a summary", async () => {
    gv().mockResolvedValue({
      id: "v-1",
      versionNo: 3,
      source: "AI",
      entityId: "ch-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      content: "他推开门。"
    });
    pc().findFirst.mockResolvedValue({ id: "ch-1", content: "他推开门，屋里很暗。" });

    const res = await call("v-1");
    const body = (await res.json()) as {
      data: {
        versionNo: number;
        summary: { addedChars: number; removedChars: number; changed: boolean };
        segments: Array<{ kind: string; text: string }>;
      };
    };

    expect(res.status).toBe(200);
    expect(body.data.versionNo).toBe(3);
    expect(body.data.summary.changed).toBe(true);
    expect(body.data.summary.removedChars).toBeGreaterThan(0);
    expect(body.data.segments.some((segment) => segment.kind === "delete")).toBe(true);
  });

  it("returns 401 when not signed in", async () => {
    const unauthorized = new Error("未登录");
    unauthorized.name = "UnauthorizedError";
    const { getOrganizationId } = await import("../../../../../../server/context");
    vi.mocked(getOrganizationId).mockRejectedValueOnce(unauthorized);

    const res = await call("v-1");
    expect(res.status).toBe(401);
  });
});
