import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({getOrganizationId: async () => "org-1", getUserId: async () => "user-1", isUnauthorizedError: () => false }));
vi.mock("../../../server/writing-assets", () => ({ createProjectMemory: vi.fn(), findMemoriesByProject: vi.fn() }));
import { GET, POST } from "./route";
import { createProjectMemory, findMemoriesByProject } from "../../../server/writing-assets";
const fp = () => findMemoriesByProject as unknown as ReturnType<typeof vi.fn>;
const cc = () => createProjectMemory as unknown as ReturnType<typeof vi.fn>;
describe("project-memories list", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("GET 200", async () => {
    fp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/project-memories?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
  it("POST 201", async () => {
    cc().mockResolvedValue({ id: "m-1" });
    const res = await POST(new Request("http://localhost/api/project-memories", { method: "POST", body: JSON.stringify({ projectId: "p", memoryType: "chapter_summary", scopeType: "chapter", scopeId: "ch-1", content: "摘要" }) }));
    expect(res.status).toBe(201);
  });
});
