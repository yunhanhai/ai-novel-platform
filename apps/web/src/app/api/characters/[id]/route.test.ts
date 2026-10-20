import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({getOrganizationId: async () => "org-1", isUnauthorizedError: () => false }));
vi.mock("../../../../server/writing-assets", () => ({ updateCharacter: vi.fn(), deleteCharacter: vi.fn() }));
import { PATCH, DELETE } from "./route";
import { updateCharacter, deleteCharacter } from "../../../../server/writing-assets";
function uc() { return updateCharacter as unknown as ReturnType<typeof vi.fn>; }
function dc() { return deleteCharacter as unknown as ReturnType<typeof vi.fn>; }
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }
describe("character [id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("PATCH 200", async () => {
    uc().mockResolvedValue({ id: "c-1" });
    const res = await PATCH(new Request("http://localhost/api/characters/c-1", { method: "PATCH", body: "{}" }), ctx("c-1"));
    expect(res.status).toBe(200);
  });
  it("DELETE 200", async () => {
    dc().mockResolvedValue({ id: "c-1" });
    const res = await DELETE(new Request("http://localhost/api/characters/c-1"), ctx("c-1"));
    expect(res.status).toBe(200);
  });
  it("DELETE 404", async () => {
    dc().mockRejectedValue(new Error("P2025"));
    const res = await DELETE(new Request("http://localhost/api/characters/c-1"), ctx("c-1"));
    expect(res.status).toBe(404);
  });
});
