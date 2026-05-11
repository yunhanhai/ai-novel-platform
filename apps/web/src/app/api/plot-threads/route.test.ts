import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({ getOrganizationId: () => "org-1", getUserId: () => "user-1" }));
vi.mock("../../../server/writing-assets", () => ({ createPlotThread: vi.fn(), findPlotThreadsByProject: vi.fn() }));
import { GET, POST } from "./route";
import { createPlotThread, findPlotThreadsByProject } from "../../../server/writing-assets";
const fp = () => findPlotThreadsByProject as unknown as ReturnType<typeof vi.fn>;
const cc = () => createPlotThread as unknown as ReturnType<typeof vi.fn>;
describe("plot-threads list", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("GET 200", async () => {
    fp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/plot-threads?projectId=proj-1"));
    expect(res.status).toBe(200);
  });
  it("POST 201", async () => {
    cc().mockResolvedValue({ id: "pt-1" });
    const res = await POST(new Request("http://localhost/api/plot-threads", { method: "POST", body: JSON.stringify({ projectId: "p", title: "线索", threadType: "main" }) }));
    expect(res.status).toBe(201);
  });
});
