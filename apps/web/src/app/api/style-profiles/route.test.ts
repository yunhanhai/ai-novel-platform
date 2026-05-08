import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findStyleProfilesByProject: vi.fn(),
  createStyleProfile: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/style-profiles", () => ({
  findStyleProfilesByProject: mocks.findStyleProfilesByProject,
  createStyleProfile: mocks.createStyleProfile
}));

describe("/api/style-profiles", () => {
  beforeEach(() => {
    process.env.DEFAULT_ORGANIZATION_ID = "org-test";
    mocks.findStyleProfilesByProject.mockReset();
    mocks.createStyleProfile.mockReset();
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORGANIZATION_ID;
  });

  describe("GET", () => {
    it("returns 400 when projectId missing", async () => {
      const { GET } = await import("./route");
      const res = await GET(new Request("http://localhost/api/style-profiles"));
      expect(res.status).toBe(400);
    });

    it("returns scoped profiles", async () => {
      mocks.findStyleProfilesByProject.mockResolvedValue([{ id: "sp1", name: "冷峻" }]);
      const { GET } = await import("./route");
      const res = await GET(new Request("http://localhost/api/style-profiles?projectId=p1"));
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(mocks.findStyleProfilesByProject).toHaveBeenCalledWith("org-test", "p1", expect.any(Object));
    });
  });

  describe("POST", () => {
    it("requires projectId and name", async () => {
      const { POST } = await import("./route");
      const res = await POST(new Request("http://localhost/api/style-profiles", {
        method: "POST",
        body: JSON.stringify({ projectId: "p1" })
      }));
      expect(res.status).toBe(400);
    });

    it("forwards optional stats fields under stats", async () => {
      mocks.createStyleProfile.mockResolvedValue({ id: "sp1", name: "标准" });
      const { POST } = await import("./route");
      const res = await POST(new Request("http://localhost/api/style-profiles", {
        method: "POST",
        body: JSON.stringify({
          projectId: "p1",
          name: "标准",
          dialogueRatio: 0.3,
          descriptionDensity: 0.5
        })
      }));
      expect(res.status).toBe(201);
      const args = mocks.createStyleProfile.mock.calls[0]?.[0];
      expect(args.stats).toEqual({ dialogueRatio: 0.3, descriptionDensity: 0.5 });
    });

    it("translates 已存在 to 409", async () => {
      mocks.createStyleProfile.mockRejectedValue(new Error("风格画像名称在项目内已存在"));
      const { POST } = await import("./route");
      const res = await POST(new Request("http://localhost/api/style-profiles", {
        method: "POST",
        body: JSON.stringify({ projectId: "p1", name: "重复" })
      }));
      expect(res.status).toBe(409);
    });
  });
});
