import { describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../../server/character-drafts", () => ({
  draftCharacters: vi.fn()
}));

import { POST } from "./route";
import { draftCharacters } from "../../../../server/character-drafts";

function dc() {
  return draftCharacters as unknown as ReturnType<typeof vi.fn>;
}

function req(body: unknown) {
  return new Request("http://localhost/api/asset-drafts/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/asset-drafts/characters", () => {
  it("rejects missing projectId", async () => {
    const res = await POST(req({ count: 3 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("projectId");
  });

  it("forwards normalized input to helper", async () => {
    dc().mockResolvedValue({ drafts: [{ name: "A" }], degraded: false });
    const res = await POST(
      req({
        projectId: "p1",
        count: 5,
        projectTitle: "  作品  ",
        genreTags: ["奇幻", "  ", 123],
        styleTags: ["冷峻"],
        premise: "  梗概  ",
        existingNames: ["李四"],
        extraPrompt: "  更暗黑  "
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.drafts).toEqual([{ name: "A" }]);
    expect(dc()).toHaveBeenCalledWith(
      {
        count: 5,
        projectTitle: "作品",
        genreTags: ["奇幻"],
        styleTags: ["冷峻"],
        premise: "梗概",
        existingNames: ["李四"],
        extraPrompt: "更暗黑"
      },
      expect.objectContaining({ organizationId: "org-1", projectId: "p1" })
    );
  });

  it("defaults count to 3 when missing", async () => {
    dc().mockResolvedValue({ drafts: [], degraded: false });
    await POST(req({ projectId: "p1" }));
    expect(dc()).toHaveBeenCalledWith(
      expect.objectContaining({ count: 3 }),
      expect.anything()
    );
  });

  it("returns 500 on helper exception", async () => {
    dc().mockRejectedValue(new Error("boom"));
    const res = await POST(req({ projectId: "p1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("boom");
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/asset-drafts/characters", {
        method: "POST",
        body: "not json"
      })
    );
    expect(res.status).toBe(400);
  });
});
