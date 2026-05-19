import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../server/model-profiles", () => ({
  createProfile: vi.fn(),
  findProfilesByOrganization: vi.fn()
}));

import { GET, POST } from "./route";
import {
  createProfile,
  findProfilesByOrganization
} from "../../../server/model-profiles";

function fp() { return findProfilesByOrganization as unknown as ReturnType<typeof vi.fn>; }
function cp() { return createProfile as unknown as ReturnType<typeof vi.fn>; }

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/model-profiles", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("GET /api/model-profiles", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 200 with profile list", async () => {
    fp().mockResolvedValue([{ id: "mpf1", name: "default", taskType: "default" }]);
    const res = await GET(new Request("http://localhost/api/model-profiles"));
    expect(res.status).toBe(200);
    expect(fp()).toHaveBeenCalledWith("org-1", {}, expect.anything());
  });

  it("forwards projectId filter", async () => {
    fp().mockResolvedValue([]);
    await GET(new Request("http://localhost/api/model-profiles?projectId=proj-1"));
    expect(fp()).toHaveBeenCalledWith("org-1", { projectId: "proj-1" }, expect.anything());
  });

  it("forwards taskType filter", async () => {
    fp().mockResolvedValue([]);
    await GET(new Request("http://localhost/api/model-profiles?taskType=deslop"));
    expect(fp()).toHaveBeenCalledWith("org-1", { taskType: "deslop" }, expect.anything());
  });

  it("returns 500 when server throws", async () => {
    fp().mockRejectedValue(new Error("boom"));
    const res = await GET(new Request("http://localhost/api/model-profiles"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/model-profiles", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when providerId missing", async () => {
    const res = await POST(req({ name: "x", modelName: "y", taskType: "default" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when modelName missing", async () => {
    const res = await POST(req({ providerId: "mp1", name: "x", taskType: "default" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when taskType invalid", async () => {
    const res = await POST(req({
      providerId: "mp1", name: "x", modelName: "y", taskType: "unknown"
    }));
    expect(res.status).toBe(400);
  });

  it("returns 201 on success", async () => {
    cp().mockResolvedValue({ id: "mpf1", name: "x" });
    const res = await POST(req({
      providerId: "mp1", name: "x", modelName: "y", taskType: "default"
    }));
    expect(res.status).toBe(201);
  });

  it("passes optional tuning params to server", async () => {
    cp().mockResolvedValue({ id: "mpf1" });
    await POST(req({
      providerId: "mp1", name: "x", modelName: "y", taskType: "polish",
      temperature: 0.5, maxOutputTokens: 1024, projectId: "proj-1"
    }));
    const call = cp().mock.calls[0]?.[0];
    expect(call).toMatchObject({
      providerId: "mp1",
      projectId: "proj-1",
      temperature: 0.5,
      maxOutputTokens: 1024
    });
  });
});
