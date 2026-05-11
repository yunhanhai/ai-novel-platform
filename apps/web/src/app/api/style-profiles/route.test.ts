import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../server/style-profiles", () => ({ createStyleProfile: vi.fn(), findStyleProfilesByProject: vi.fn() }));
import { GET, POST } from "./route";
import { createStyleProfile, findStyleProfilesByProject } from "../../../server/style-profiles";
const fp = () => findStyleProfilesByProject as unknown as ReturnType<typeof vi.fn>;
const cc = () => createStyleProfile as unknown as ReturnType<typeof vi.fn>;
describe("style-profiles", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("GET 200", async () => {
    fp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/style-profiles?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
  it("POST 400", async () => {
    const res = await POST(new Request("http://localhost/api/style-profiles", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it("POST 201", async () => {
    cc().mockResolvedValue({ id: "sp-1" });
    const res = await POST(new Request("http://localhost/api/style-profiles", { method: "POST", body: JSON.stringify({ projectId: "p", name: "风格" }) }));
    expect(res.status).toBe(201);
  });
});
