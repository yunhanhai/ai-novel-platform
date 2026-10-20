import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({getOrganizationId: async () => "org-1", isUnauthorizedError: () => false }));
vi.mock("../../../../server/writing-methodologies", () => ({ updateMethodology: vi.fn(), deactivateMethodology: vi.fn() }));
import { PATCH, DELETE } from "./route";
import { updateMethodology, deactivateMethodology } from "../../../../server/writing-methodologies";
const up = () => updateMethodology as unknown as ReturnType<typeof vi.fn>;
const del = () => deactivateMethodology as unknown as ReturnType<typeof vi.fn>;
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }
describe("methodology [id]", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("PATCH 200", async () => {
    up().mockResolvedValue({ id: "wm-1" });
    const res = await PATCH(new Request("http://localhost/api/writing-methodologies/wm-1", { method: "PATCH", body: "{}" }), ctx("wm-1"));
    expect(res.status).toBe(200);
  });
  it("DELETE 200", async () => {
    del().mockResolvedValue({ id: "wm-1" });
    const res = await DELETE(new Request("http://localhost/api/writing-methodologies/wm-1"), ctx("wm-1"));
    expect(res.status).toBe(200);
  });
});
