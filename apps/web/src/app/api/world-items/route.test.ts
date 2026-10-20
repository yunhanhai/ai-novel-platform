import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({getOrganizationId: async () => "org-1", getUserId: async () => "user-1", isUnauthorizedError: () => false }));
vi.mock("../../../server/writing-assets", () => ({ createWorldItem: vi.fn(), findWorldItemsByProject: vi.fn() }));
import { GET, POST } from "./route";
import { createWorldItem, findWorldItemsByProject } from "../../../server/writing-assets";
const fp = () => findWorldItemsByProject as unknown as ReturnType<typeof vi.fn>;
const cc = () => createWorldItem as unknown as ReturnType<typeof vi.fn>;
describe("world-items list", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("GET 200", async () => {
    fp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/world-items?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
  it("GET 400", async () => {
    const res = await GET(new Request("http://localhost/api/world-items"));
    expect(res.status).toBe(400);
  });
  it("POST 201", async () => {
    cc().mockResolvedValue({ id: "w-1" });
    const res = await POST(new Request("http://localhost/api/world-items", { method: "POST", body: JSON.stringify({ projectId: "p", name: "世界", itemType: "location" }) }));
    expect(res.status).toBe(201);
  });
});
