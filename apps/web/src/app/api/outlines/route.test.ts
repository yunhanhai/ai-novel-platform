import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));

vi.mock("../../../server/context", () => ({
  getOrganizationId: () => "org-1",
  getUserId: () => "user-1"
}));

vi.mock("../../../server/outlines", () => ({
  createOutline: vi.fn(),
  findOutlinesByProject: vi.fn()
}));

import { GET, POST } from "./route";
import { createOutline, findOutlinesByProject } from "../../../server/outlines";

const fp = () => findOutlinesByProject as unknown as ReturnType<typeof vi.fn>;
const co = () => createOutline as unknown as ReturnType<typeof vi.fn>;

describe("outlines API", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("GET returns 400 without projectId", async () => {
    const res = await GET(new Request("http://localhost/api/outlines"));
    expect(res.status).toBe(400);
  });

  it("GET returns list (200)", async () => {
    fp().mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/outlines?projectId=proj-1"));
    expect(res.status).toBe(200);
  });

  it("POST returns 400 missing level", async () => {
    const res = await POST(new Request("http://localhost/api/outlines", {
      method: "POST", body: JSON.stringify({ projectId: "p", title: "大纲" })
    }));
    expect(res.status).toBe(400);
  });

  it("POST creates outline (201)", async () => {
    co().mockResolvedValue({ id: "o-1", title: "第一章", level: "CHAPTER" });
    const res = await POST(new Request("http://localhost/api/outlines", {
      method: "POST", body: JSON.stringify({ projectId: "p", level: "CHAPTER", title: "第一章" })
    }));
    expect(res.status).toBe(201);
  });
});
