import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => {
  const txClient = {
    project: { create: vi.fn() },
    writingMethodology: { create: vi.fn() },
    outline: { createMany: vi.fn() }
  };
  return {
    prisma: {
      project: {
        findMany: vi.fn(),
        create: txClient.project.create
      },
      writingMethodology: txClient.writingMethodology,
      outline: txClient.outline,
      chapter: {
        count: vi.fn()
      },
      $transaction: vi.fn(
        async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)
      )
    },
    Prisma: { JsonNull: Symbol("JsonNull") }
  };
});

vi.mock("../../../server/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/context")>();
  return {
    getOrganizationId: vi.fn(async () => "org-1"),
    getUserId: vi.fn(async () => "user-1"),
    isUnauthorizedError: actual.isUnauthorizedError,
    UnauthorizedError: actual.UnauthorizedError
  };
});

import { GET, POST } from "./route";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, UnauthorizedError } from "../../../server/context";

type MockPrisma = {
  project: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  chapter: { count: ReturnType<typeof vi.fn> };
};

function p() { return prisma as unknown as MockPrisma; }

describe("GET /api/projects", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns project list with chapter counts (200)", async () => {
    p().project.findMany.mockResolvedValue([
      { id: "proj-1", title: "测试作品", slug: "test", type: "LONG_NOVEL", genre: null, status: "DRAFT", updatedAt: new Date("2026-01-01") }
    ]);
    p().chapter.count.mockResolvedValue(0);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].chapterCount).toBe(0);
  });

  it("returns 500 when prisma throws", async () => {
    p().project.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("returns 401 when the session is missing", async () => {
    vi.mocked(getOrganizationId).mockRejectedValueOnce(new UnauthorizedError());
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});

describe("POST /api/projects", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/projects", { method: "POST", body: JSON.stringify(body) });
  }

  it("creates project and returns 201", async () => {
    p().project.create.mockResolvedValue({
      id: "new-proj", title: "新作品", slug: "new", type: "LONG_NOVEL", genre: null, status: "DRAFT", updatedAt: new Date()
    });
    p().chapter.count.mockResolvedValue(0);
    const res = await POST(req({ title: "新作品", slug: "new" }));
    expect(res.status).toBe(201);
  });

  it("returns 400 when title or slug missing", async () => {
    const res = await POST(req({ title: "only title" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when slug format invalid", async () => {
    const res = await POST(req({ title: "T", slug: "Invalid Slug" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 when slug already taken", async () => {
    p().project.create.mockRejectedValue(new Error("已被占用"));
    const res = await POST(req({ title: "dup", slug: "dup" }));
    expect(res.status).toBe(409);
  });
});
