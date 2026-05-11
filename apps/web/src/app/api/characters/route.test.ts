import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({ getOrganizationId: () => "org-1", getUserId: () => "user-1" }));
vi.mock("../../../server/writing-assets", () => ({ createCharacter: vi.fn(), findCharactersByProject: vi.fn() }));
import { GET, POST } from "./route";
import { createCharacter, findCharactersByProject } from "../../../server/writing-assets";
function fp() { return findCharactersByProject as unknown as ReturnType<typeof vi.fn>; }
function cc() { return createCharacter as unknown as ReturnType<typeof vi.fn>; }
describe("characters CRUD", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("GET returns 400 without projectId", async () => {
    const res = await GET(new Request("http://localhost/api/characters"));
    expect(res.status).toBe(400);
  });
  it("GET returns 200 with list", async () => {
    fp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/characters?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
  it("POST returns 400 missing fields", async () => {
    const res = await POST(new Request("http://localhost/api/characters", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it("POST returns 201", async () => {
    cc().mockResolvedValue({ id: "c-1" });
    const res = await POST(new Request("http://localhost/api/characters", { method: "POST", body: JSON.stringify({ projectId: "p", name: "角色", roleType: "protagonist" }) }));
    expect(res.status).toBe(201);
  });
});
