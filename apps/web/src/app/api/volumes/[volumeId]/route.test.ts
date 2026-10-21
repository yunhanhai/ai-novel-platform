import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("../../../../server/chapters", () => ({
  updateVolume: vi.fn(),
  deleteVolume: vi.fn()
}));

import { DELETE, PATCH } from "./route";
import { deleteVolume, updateVolume } from "../../../../server/chapters";

function uv() {
  return updateVolume as unknown as ReturnType<typeof vi.fn>;
}
function dv() {
  return deleteVolume as unknown as ReturnType<typeof vi.fn>;
}

const ctx = { params: Promise.resolve({ volumeId: "vol-1" }) };

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://localhost/api/volumes/vol-1", { method: "PATCH", body: JSON.stringify(body) }),
    ctx
  );
}

describe("PATCH /api/volumes/[volumeId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid status", async () => {
    const res = await patch({ status: "WHATEVER" });
    expect(res.status).toBe(400);
    expect(uv()).not.toHaveBeenCalled();
  });

  it("rejects a blank title", async () => {
    const res = await patch({ title: "  " });
    expect(res.status).toBe(400);
  });

  it("renames a volume with a trimmed title", async () => {
    uv().mockResolvedValue({ id: "vol-1", title: "第一卷", summary: null, orderIndex: 1, status: "PLANNED" });

    const res = await patch({ title: "  第一卷 风起  " });

    expect(res.status).toBe(200);
    expect(uv()).toHaveBeenCalledWith(
      "org-1",
      "vol-1",
      expect.objectContaining({ title: "第一卷 风起" }),
      expect.anything()
    );
  });

  it("returns 404 when the volume is missing", async () => {
    uv().mockRejectedValue(new Error("P2025 Record not found"));
    const res = await patch({ title: "第一卷" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/volumes/[volumeId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the volume (chapters are detached server-side)", async () => {
    dv().mockResolvedValue({ id: "vol-1" });

    const res = await DELETE(
      new Request("http://localhost/api/volumes/vol-1", { method: "DELETE" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(dv()).toHaveBeenCalledWith("org-1", "vol-1", expect.anything());
  });

  it("returns 404 when the volume is already gone", async () => {
    dv().mockRejectedValue(new Error("P2025 Record not found"));
    const res = await DELETE(
      new Request("http://localhost/api/volumes/vol-1", { method: "DELETE" }),
      ctx
    );
    expect(res.status).toBe(404);
  });
});
