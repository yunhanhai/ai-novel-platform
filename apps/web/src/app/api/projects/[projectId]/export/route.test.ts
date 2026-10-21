import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("@ai-novel/db", () => ({
  prisma: { project: { findFirst: vi.fn() }, chapter: { findMany: vi.fn() } }
}));

import { GET } from "./route";
import { getOrganizationId } from "../../../../../server/context";
import { prisma } from "@ai-novel/db";

function p() {
  return prisma as unknown as {
    project: { findFirst: ReturnType<typeof vi.fn> };
    chapter: { findMany: ReturnType<typeof vi.fn> };
  };
}

function call() {
  return GET(new Request("http://localhost/api/projects/p-1/export"), {
    params: Promise.resolve({ projectId: "p-1" })
  });
}

describe("GET /api/projects/[projectId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not signed in", async () => {
    const unauthorized = new Error("未登录");
    unauthorized.name = "UnauthorizedError";
    vi.mocked(getOrganizationId).mockRejectedValueOnce(unauthorized);

    const res = await call();
    expect(res.status).toBe(401);
  });

  it("returns 404 when the project does not exist", async () => {
    p().project.findFirst.mockResolvedValue(null);

    const res = await call();
    expect(res.status).toBe(404);
  });

  it("returns 400 when there are no chapters", async () => {
    p().project.findFirst.mockResolvedValue({ title: "长夜", createdBy: { displayName: "林墨" } });
    p().chapter.findMany.mockResolvedValue([]);

    const res = await call();
    expect(res.status).toBe(400);
  });

  it("returns a text attachment with all chapters", async () => {
    p().project.findFirst.mockResolvedValue({ title: "长夜", createdBy: { displayName: "林墨" } });
    p().chapter.findMany.mockResolvedValue([
      { chapterNo: 1, title: "开门", content: "正文", wordCount: 2 }
    ]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const text = await res.text();
    expect(text).toContain("长夜");
    expect(text).toContain("第1章 开门");
  });

  it("scopes both queries to the session organization", async () => {
    p().project.findFirst.mockResolvedValue(null);
    await call();

    expect(p().project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "p-1", organizationId: "org-1" })
      })
    );
  });
});
