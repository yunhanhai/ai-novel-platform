import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: () => "org-1"
}));

vi.mock("../../../../server/wizard-drafts", () => ({
  draftOutline: vi.fn()
}));

import { POST } from "./route";
import { draftOutline } from "../../../../server/wizard-drafts";

const fn = () => draftOutline as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/wizard/draft-outline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400 when body is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/wizard/draft-outline", {
        method: "POST",
        body: "not-json"
      })
    );
    expect(res.status).toBe(400);
  });

  it("400 when methodType missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/wizard/draft-outline", {
        method: "POST",
        body: JSON.stringify({ premise: "x" })
      })
    );
    expect(res.status).toBe(400);
  });

  it("400 when methodType invalid", async () => {
    const res = await POST(
      new Request("http://localhost/api/wizard/draft-outline", {
        method: "POST",
        body: JSON.stringify({ methodType: "nonsense" })
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with nodes + degraded", async () => {
    fn().mockResolvedValue({
      nodes: [{ level: "VOLUME", title: "T", summary: "S", orderIndex: 0 }],
      degraded: false
    });

    const res = await POST(
      new Request("http://localhost/api/wizard/draft-outline", {
        method: "POST",
        body: JSON.stringify({
          methodType: "three_act",
          genreTags: ["奇幻"],
          premise: "梗概"
        })
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { nodes: { level: string }[]; degraded: boolean };
    };
    expect(json.success).toBe(true);
    expect(json.data.nodes).toHaveLength(1);
    expect(json.data.degraded).toBe(false);

    expect(fn()).toHaveBeenCalledWith(
      expect.objectContaining({
        methodType: "three_act",
        genreTags: ["奇幻"],
        premise: "梗概"
      }),
      expect.objectContaining({ organizationId: "org-1" })
    );
  });

  it("propagates degraded=true", async () => {
    fn().mockResolvedValue({ nodes: [], degraded: true });
    const res = await POST(
      new Request("http://localhost/api/wizard/draft-outline", {
        method: "POST",
        body: JSON.stringify({ methodType: "snowflake" })
      })
    );
    const json = (await res.json()) as { data: { degraded: boolean } };
    expect(json.data.degraded).toBe(true);
  });

  it("500 when draftOutline throws", async () => {
    fn().mockRejectedValue(new Error("boom"));

    const res = await POST(
      new Request("http://localhost/api/wizard/draft-outline", {
        method: "POST",
        body: JSON.stringify({ methodType: "three_act" })
      })
    );
    expect(res.status).toBe(500);
  });
});
