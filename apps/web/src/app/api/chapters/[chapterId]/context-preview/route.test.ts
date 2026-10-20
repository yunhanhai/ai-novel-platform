import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {}
}));

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../../../server/context-preview", () => ({
  buildChapterContextPreview: vi.fn()
}));

import { GET, POST } from "./route";
import { buildChapterContextPreview } from "../../../../../server/context-preview";

function previewBuilder() { return buildChapterContextPreview as unknown as ReturnType<typeof vi.fn>; }
function routeCtx(chapterId: string) { return { params: Promise.resolve({ chapterId }) }; }
function postReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/chapters/ch-1/context-preview", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

const preview = {
  chapterId: "ch-1",
  projectId: "proj-1",
  budgetPreset: "standard",
  tokenBudget: 4000,
  estimatedTokens: 123,
  included: [],
  trimmed: [],
  available: [],
  excluded: [],
  forced: [],
  required: [],
  promptPreview: "context",
  activationReport: {},
  warnings: []
};

describe("/api/chapters/[chapterId]/context-preview", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("GET returns a default context preview", async () => {
    previewBuilder().mockResolvedValue(preview);

    const res = await GET(new Request("http://localhost/api/chapters/ch-1/context-preview"), routeCtx("ch-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.promptPreview).toBe("context");
    expect(previewBuilder()).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      chapterId: "ch-1",
      rawOptions: expect.objectContaining({ excludedAssetIds: [], forcedAssetIds: [] })
    }));
  });

  it("POST accepts context options", async () => {
    previewBuilder().mockResolvedValue({ ...preview, budgetPreset: "compact" });

    const res = await POST(postReq({
      contextOptions: { budgetPreset: "compact", excludedAssetIds: ["ch2"], forcedAssetIds: ["w1"] }
    }), routeCtx("ch-1"));

    expect(res.status).toBe(200);
    expect(previewBuilder()).toHaveBeenCalledWith(expect.objectContaining({
      rawOptions: expect.objectContaining({ budgetPreset: "compact", excludedAssetIds: ["ch2"], forcedAssetIds: ["w1"] })
    }));
  });

  it("returns 400 for invalid options", async () => {
    const res = await POST(postReq({ contextOptions: { budgetPreset: "huge" } }), routeCtx("ch-1"));

    expect(res.status).toBe(400);
    expect(previewBuilder()).not.toHaveBeenCalled();
  });

  it("returns 404 when chapter is missing", async () => {
    previewBuilder().mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/chapters/missing/context-preview"), routeCtx("missing"));

    expect(res.status).toBe(404);
  });
});
