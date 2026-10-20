import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../../server/context", () => ({
  getOrganizationId: async () => "org-1",
  isUnauthorizedError: () => false
}));

vi.mock("../../../../server/wizard-drafts", () => ({
  draftPremise: vi.fn()
}));

import { POST } from "./route";
import { draftPremise } from "../../../../server/wizard-drafts";

const dp = () => draftPremise as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/wizard/draft-premise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400 when body is not JSON", async () => {
    const req = new Request("http://localhost/api/wizard/draft-premise", {
      method: "POST",
      body: "not-json"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 with text + degraded from draftPremise", async () => {
    dp().mockResolvedValue({ text: "占位梗概", degraded: false });

    const res = await POST(
      new Request("http://localhost/api/wizard/draft-premise", {
        method: "POST",
        body: JSON.stringify({
          projectTitle: "X",
          genreTags: ["奇幻", "  ", 123],
          styleTags: "ignored",
          oneLiner: "  少年觉醒  "
        })
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; data: { text: string; degraded: boolean } };
    expect(json.success).toBe(true);
    expect(json.data.text).toBe("占位梗概");
    expect(json.data.degraded).toBe(false);

    expect(dp()).toHaveBeenCalledWith(
      expect.objectContaining({
        projectTitle: "X",
        genreTags: ["奇幻"],
        oneLiner: "少年觉醒"
      }),
      expect.objectContaining({ organizationId: "org-1" })
    );
  });

  it("propagates degraded=true flag from draftPremise", async () => {
    dp().mockResolvedValue({ text: "占位", degraded: true });

    const res = await POST(
      new Request("http://localhost/api/wizard/draft-premise", {
        method: "POST",
        body: JSON.stringify({ projectTitle: "X" })
      })
    );

    const json = (await res.json()) as { success: boolean; data: { degraded: boolean } };
    expect(json.data.degraded).toBe(true);
  });

  it("returns 500 when draftPremise throws", async () => {
    dp().mockRejectedValue(new Error("boom"));

    const res = await POST(
      new Request("http://localhost/api/wizard/draft-premise", {
        method: "POST",
        body: JSON.stringify({})
      })
    );

    expect(res.status).toBe(500);
  });
});
