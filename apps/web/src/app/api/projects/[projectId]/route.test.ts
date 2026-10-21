import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("../../../../server/projects", () => ({
  updateProject: vi.fn(),
  softDeleteProject: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({
  prisma: { project: { findFirst: vi.fn() } }
}));

import { DELETE, GET, PATCH } from "./route";
import { softDeleteProject, updateProject } from "../../../../server/projects";
import { prisma } from "@ai-novel/db";

function up() {
  return updateProject as unknown as ReturnType<typeof vi.fn>;
}
function sd() {
  return softDeleteProject as unknown as ReturnType<typeof vi.fn>;
}
function pp() {
  return (prisma as unknown as { project: { findFirst: ReturnType<typeof vi.fn> } }).project;
}

const ctx = { params: Promise.resolve({ projectId: "p-1" }) };

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("http://localhost/api/projects/p-1", { method: "PATCH", body: JSON.stringify(body) }), ctx);
}

describe("GET /api/projects/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the project is missing", async () => {
    pp().findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/projects/p-1"), ctx);
    expect(res.status).toBe(404);
  });

  it("returns the project detail", async () => {
    pp().findFirst.mockResolvedValue({
      id: "p-1",
      title: "长夜",
      genre: "悬疑",
      styleBrief: "冷峻",
      premise: "少年入京",
      status: "ACTIVE"
    });
    const res = await GET(new Request("http://localhost/api/projects/p-1"), ctx);
    const body = (await res.json()) as { data: { title: string } };
    expect(res.status).toBe(200);
    expect(body.data.title).toBe("长夜");
  });
});

describe("PATCH /api/projects/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid status", async () => {
    const res = await patch({ status: "WHATEVER" });
    expect(res.status).toBe(400);
  });

  it("rejects a blank title", async () => {
    const res = await patch({ title: "   " });
    expect(res.status).toBe(400);
  });

  it("updates trimmed fields", async () => {
    up().mockResolvedValue({
      id: "p-1",
      title: "长夜",
      genre: "悬疑",
      styleBrief: null,
      premise: null,
      status: "ACTIVE"
    });

    const res = await patch({ title: "  长夜  ", genre: "悬疑", status: "ACTIVE" });

    expect(res.status).toBe(200);
    expect(up()).toHaveBeenCalledWith(
      "org-1",
      "p-1",
      expect.objectContaining({ title: "长夜", genre: "悬疑", status: "ACTIVE" }),
      expect.anything()
    );
  });

  it("returns 404 when the project does not exist", async () => {
    up().mockRejectedValue(new Error("P2025 Record not found"));
    const res = await patch({ title: "长夜" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soft deletes an existing project", async () => {
    pp().findFirst.mockResolvedValue({ id: "p-1" });
    sd().mockResolvedValue({});

    const res = await DELETE(new Request("http://localhost/api/projects/p-1", { method: "DELETE" }), ctx);

    expect(res.status).toBe(200);
    expect(sd()).toHaveBeenCalledWith("org-1", "p-1", expect.anything());
  });

  it("returns 404 when the project is already gone", async () => {
    pp().findFirst.mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost/api/projects/p-1", { method: "DELETE" }), ctx);
    expect(res.status).toBe(404);
    expect(sd()).not.toHaveBeenCalled();
  });
});
