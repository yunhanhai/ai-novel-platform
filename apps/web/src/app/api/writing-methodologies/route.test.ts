import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../server/writing-methodologies", () => ({ createMethodology: vi.fn(), findMethodologiesByProject: vi.fn() }));
import { GET, POST } from "./route";
import { createMethodology, findMethodologiesByProject } from "../../../server/writing-methodologies";
const fp = () => findMethodologiesByProject as unknown as ReturnType<typeof vi.fn>;
const cc = () => createMethodology as unknown as ReturnType<typeof vi.fn>;
describe("methodologies", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("GET 200", async () => {
    fp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/writing-methodologies?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
  it("POST 400", async () => {
    const res = await POST(new Request("http://localhost/api/writing-methodologies", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it("POST 201", async () => {
    cc().mockResolvedValue({ id: "wm-1" });
    const res = await POST(new Request("http://localhost/api/writing-methodologies", { method: "POST", body: JSON.stringify({ projectId: "p", name: "方法", methodType: "snowflake" }) }));
    expect(res.status).toBe(201);
  });
});
