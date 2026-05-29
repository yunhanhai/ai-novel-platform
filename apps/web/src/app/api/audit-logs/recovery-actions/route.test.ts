import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganizationIdMock = vi.hoisted(() => vi.fn());
const getRecoveryAuditLogsMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-novel/db", () => ({
  prisma: {}
}));

vi.mock("../../../../server/context", () => ({
  getOrganizationId: getOrganizationIdMock
}));

vi.mock("../../../../server/recovery-audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../server/recovery-audit")>();
  return {
    ...actual,
    getRecoveryAuditLogs: getRecoveryAuditLogsMock
  };
});

import { prisma } from "@ai-novel/db";
import { GET } from "./route";

describe("GET /api/audit-logs/recovery-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizationIdMock.mockReturnValue("org-1");
    getRecoveryAuditLogsMock.mockResolvedValue({
      items: [],
      total: 0
    });
  });

  it("returns the default recovery audit list", async () => {
    const res = await GET(new Request("http://localhost/api/audit-logs/recovery-actions"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(getRecoveryAuditLogsMock).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1",
      limit: 10
    });
  });

  it("clamps the limit", async () => {
    await GET(new Request("http://localhost/api/audit-logs/recovery-actions?limit=999"));

    expect(getRecoveryAuditLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
  });

  it("returns 400 for invalid limit", async () => {
    const res = await GET(new Request("http://localhost/api/audit-logs/recovery-actions?limit=abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(getRecoveryAuditLogsMock).not.toHaveBeenCalled();
  });

  it("returns 500 when organization context is missing", async () => {
    getOrganizationIdMock.mockImplementation(() => {
      throw new Error("DEFAULT_ORGANIZATION_ID missing");
    });

    const res = await GET(new Request("http://localhost/api/audit-logs/recovery-actions"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("DEFAULT_ORGANIZATION_ID");
  });
});
