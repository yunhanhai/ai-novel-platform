import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("../../../server/world-item-drafts", () => ({ draftWorldItems: vi.fn() }));
vi.mock("../../../server/outline-drafts", () => ({ draftOutlineNodes: vi.fn() }));
vi.mock("../../../server/plot-thread-drafts", () => ({ draftPlotThreads: vi.fn() }));
vi.mock("../../../server/style-profile-drafts", () => ({ draftStyleProfiles: vi.fn() }));
vi.mock("../../../server/deslop-rule-drafts", () => ({ draftDeslopRules: vi.fn() }));

import { POST as worldPost } from "./world-items/route";
import { POST as outlinePost } from "./outlines/route";
import { POST as plotPost } from "./plot-threads/route";
import { POST as stylePost } from "./style-profiles/route";
import { POST as deslopPost } from "./deslop-rules/route";
import { draftWorldItems } from "../../../server/world-item-drafts";
import { draftOutlineNodes } from "../../../server/outline-drafts";
import { draftPlotThreads } from "../../../server/plot-thread-drafts";
import { draftStyleProfiles } from "../../../server/style-profile-drafts";
import { draftDeslopRules } from "../../../server/deslop-rule-drafts";

function req(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/asset-drafts/world-items", () => {
  beforeEach(() => vi.clearAllMocks());
  it("forwards focusType and tags", async () => {
    (draftWorldItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [{ name: "X" }], degraded: false
    });
    const res = await worldPost(
      req("/api/asset-drafts/world-items", {
        projectId: "p1", count: 2, focusType: "location",
        genreTags: ["奇幻"], extraPrompt: " hello "
      })
    );
    expect(res.status).toBe(200);
    expect(draftWorldItems).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 2, focusType: "location",
        genreTags: ["奇幻"], extraPrompt: "hello"
      }),
      expect.objectContaining({ projectId: "p1" })
    );
  });
  it("rejects invalid focusType silently (does not include in input)", async () => {
    (draftWorldItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [], degraded: false
    });
    await worldPost(req("/api/asset-drafts/world-items", { projectId: "p1", focusType: "garbage" }));
    const call = (draftWorldItems as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).not.toHaveProperty("focusType");
  });
  it("returns 400 when projectId missing", async () => {
    const res = await worldPost(req("/api/asset-drafts/world-items", { count: 1 }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/asset-drafts/outlines", () => {
  beforeEach(() => vi.clearAllMocks());
  it("forwards level/startOrderIndex/parentTitle", async () => {
    (draftOutlineNodes as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [], degraded: false
    });
    await outlinePost(
      req("/api/asset-drafts/outlines", {
        projectId: "p1", count: 3, level: "VOLUME",
        startOrderIndex: 7, parentTitle: "第一卷"
      })
    );
    expect(draftOutlineNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "VOLUME", startOrderIndex: 7, parentTitle: "第一卷"
      }),
      expect.anything()
    );
  });
  it("ignores invalid level", async () => {
    (draftOutlineNodes as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [], degraded: false
    });
    await outlinePost(req("/api/asset-drafts/outlines", { projectId: "p1", level: "garbage" }));
    const call = (draftOutlineNodes as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).not.toHaveProperty("level");
  });
});

describe("POST /api/asset-drafts/plot-threads", () => {
  beforeEach(() => vi.clearAllMocks());
  it("forwards focusType and existingTitles", async () => {
    (draftPlotThreads as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [], degraded: false
    });
    await plotPost(
      req("/api/asset-drafts/plot-threads", {
        projectId: "p1", focusType: "mystery",
        existingTitles: ["旧伏笔A", "旧伏笔B"]
      })
    );
    expect(draftPlotThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        focusType: "mystery",
        existingTitles: ["旧伏笔A", "旧伏笔B"]
      }),
      expect.anything()
    );
  });
  it("returns 500 on helper exception", async () => {
    (draftPlotThreads as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("oops"));
    const res = await plotPost(req("/api/asset-drafts/plot-threads", { projectId: "p1" }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/asset-drafts/style-profiles", () => {
  beforeEach(() => vi.clearAllMocks());
  it("forwards count and tags", async () => {
    (draftStyleProfiles as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [], degraded: false
    });
    await stylePost(
      req("/api/asset-drafts/style-profiles", {
        projectId: "p1", count: 2, genreTags: ["奇幻"]
      })
    );
    expect(draftStyleProfiles).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2, genreTags: ["奇幻"] }),
      expect.anything()
    );
  });
  it("returns 400 when projectId missing", async () => {
    const res = await stylePost(req("/api/asset-drafts/style-profiles", {}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/asset-drafts/deslop-rules", () => {
  beforeEach(() => vi.clearAllMocks());
  it("forwards focusCategory and existingPatterns", async () => {
    (draftDeslopRules as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [], degraded: false
    });
    await deslopPost(
      req("/api/asset-drafts/deslop-rules", {
        projectId: "p1", focusCategory: "stock_phrase",
        existingPatterns: ["仿佛"]
      })
    );
    expect(draftDeslopRules).toHaveBeenCalledWith(
      expect.objectContaining({
        focusCategory: "stock_phrase", existingPatterns: ["仿佛"]
      }),
      expect.anything()
    );
  });
  it("ignores invalid focusCategory", async () => {
    (draftDeslopRules as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drafts: [], degraded: false
    });
    await deslopPost(req("/api/asset-drafts/deslop-rules", {
      projectId: "p1", focusCategory: "garbage"
    }));
    const call = (draftDeslopRules as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).not.toHaveProperty("focusCategory");
  });
});
