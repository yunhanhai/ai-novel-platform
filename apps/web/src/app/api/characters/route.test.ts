import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCharactersByProject: vi.fn(),
  createCharacter: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/writing-assets", () => ({
  findCharactersByProject: mocks.findCharactersByProject,
  createCharacter: mocks.createCharacter
}));

describe("/api/characters", () => {
  beforeEach(() => {
    process.env.DEFAULT_ORGANIZATION_ID = "org-test";
    process.env.DEFAULT_USER_ID = "user-test";
    mocks.findCharactersByProject.mockReset();
    mocks.createCharacter.mockReset();
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORGANIZATION_ID;
    delete process.env.DEFAULT_USER_ID;
  });

  it("GET requires projectId", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/characters"));
    expect(res.status).toBe(400);
  });

  it("GET returns scoped list", async () => {
    mocks.findCharactersByProject.mockResolvedValue([{ id: "c1", name: "林无忌" }]);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/characters?projectId=p1"));
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(mocks.findCharactersByProject).toHaveBeenCalledWith("org-test", "p1", expect.any(Object));
  });

  it("POST validates required fields", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/characters", {
      method: "POST",
      body: JSON.stringify({ projectId: "p1", name: "无忌" })
    }));
    expect(res.status).toBe(400);
  });

  it("POST creates character with createdById from env", async () => {
    mocks.createCharacter.mockResolvedValue({ id: "c1", name: "无忌" });
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/characters", {
      method: "POST",
      body: JSON.stringify({ projectId: "p1", name: "无忌", roleType: "protagonist" })
    }));
    expect(res.status).toBe(201);
    expect(mocks.createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      createdById: "user-test",
      organizationId: "org-test",
      roleType: "protagonist"
    }));
  });
});
