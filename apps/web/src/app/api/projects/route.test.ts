import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 模拟 prisma client 和 server 层
const mocks = vi.hoisted(() => ({
  findProjectsByOrganization: vi.fn(),
  createProject: vi.fn(),
  prismaChapterCount: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({
  prisma: {
    chapter: { count: mocks.prismaChapterCount }
  },
  createJob: vi.fn()
}));

vi.mock("../../../server/projects", () => ({
  findProjectsByOrganization: mocks.findProjectsByOrganization,
  createProject: mocks.createProject
}));

describe("/api/projects", () => {
  beforeEach(() => {
    process.env.DEFAULT_ORGANIZATION_ID = "org-test";
    process.env.DEFAULT_USER_ID = "user-test";
    mocks.findProjectsByOrganization.mockReset();
    mocks.createProject.mockReset();
    mocks.prismaChapterCount.mockReset();
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORGANIZATION_ID;
    delete process.env.DEFAULT_USER_ID;
  });

  describe("GET", () => {
    it("returns projects scoped to current organization", async () => {
      mocks.findProjectsByOrganization.mockResolvedValue([
        {
          id: "p1", title: "星辰坠落", slug: "starfall", type: "LONG_NOVEL",
          genre: "科幻", status: "DRAFT", updatedAt: new Date("2026-04-29")
        }
      ]);
      mocks.prismaChapterCount.mockResolvedValue(3);

      const { GET } = await import("./route");
      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0]).toMatchObject({ id: "p1", title: "星辰坠落", chapterCount: 3 });
      expect(mocks.findProjectsByOrganization).toHaveBeenCalledWith("org-test", expect.any(Object));
    });

    it("returns 500 with friendly message when org context missing", async () => {
      delete process.env.DEFAULT_ORGANIZATION_ID;
      const { GET } = await import("./route");
      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/DEFAULT_ORGANIZATION_ID/);
    });
  });

  describe("POST", () => {
    it("rejects when title or slug missing", async () => {
      const { POST } = await import("./route");
      const res = await POST(new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ title: "Foo" })
      }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("rejects malformed slug", async () => {
      const { POST } = await import("./route");
      const res = await POST(new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ title: "Foo", slug: "Foo Bar" })
      }));
      expect(res.status).toBe(400);
    });

    it("creates project and returns 201", async () => {
      mocks.createProject.mockResolvedValue({
        id: "p2", title: "新作", slug: "new-novel", type: "LONG_NOVEL",
        genre: null, status: "DRAFT", updatedAt: new Date("2026-04-29")
      });
      mocks.prismaChapterCount.mockResolvedValue(0);

      const { POST } = await import("./route");
      const res = await POST(new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ title: "新作", slug: "new-novel" })
      }));
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBe("p2");
      expect(mocks.createProject).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: "org-test",
        createdById: "user-test",
        title: "新作",
        slug: "new-novel"
      }));
    });

    it("returns 409 when slug already taken", async () => {
      mocks.createProject.mockRejectedValue(new Error("项目标识已被占用"));
      const { POST } = await import("./route");
      const res = await POST(new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ title: "Bar", slug: "bar" })
      }));
      expect(res.status).toBe(409);
    });
  });
});
