import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../../server/style-profiles", () => ({ updateStyleProfile: vi.fn(), deactivateStyleProfile: vi.fn() }));
import { PATCH, DELETE } from "./route";
import { updateStyleProfile, deactivateStyleProfile } from "../../../../server/style-profiles";
const up = () => updateStyleProfile as unknown as ReturnType<typeof vi.fn>;
const del = () => deactivateStyleProfile as unknown as ReturnType<typeof vi.fn>;
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }
describe("style-profile [id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("PATCH 200", async () => {
    up().mockResolvedValue({ id: "sp-1" });
    const res = await PATCH(new Request("http://localhost/api/style-profiles/sp-1", { method: "PATCH", body: "{}" }), ctx("sp-1"));
    expect(res.status).toBe(200);
  });
  it("DELETE 200", async () => {
    del().mockResolvedValue({ id: "sp-1" });
    const res = await DELETE(new Request("http://localhost/api/style-profiles/sp-1"), ctx("sp-1"));
    expect(res.status).toBe(200);
  });
});
