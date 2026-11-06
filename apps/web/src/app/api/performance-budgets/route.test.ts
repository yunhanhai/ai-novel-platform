import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({
  prisma: {
    project: {
      findFirst: vi.fn()
    }
  }
}));

vi.mock("../../../server/context", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../server/context")>(),
  requireSession: vi.fn(async () => ({ organizationId: "org-1", userId: "user-1", displayName: "测试" }))
}));

vi.mock("../../../server/performance-budgets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/performance-budgets")>();
  return {
    ...actual,
    deactivatePerformanceBudget: vi.fn(),
    listPerformanceBudgets: vi.fn(),
    upsertPerformanceBudget: vi.fn()
  };
});

import { prisma } from "@ai-novel/db";
import { requireSession, UnauthorizedError } from "../../../server/context";
import { GET, PUT } from "./route";
import {
  deactivatePerformanceBudget,
  listPerformanceBudgets,
  upsertPerformanceBudget
} from "../../../server/performance-budgets";

function projectFindFirst() {
  return prisma.project.findFirst as unknown as ReturnType<typeof vi.fn>;
}

function listBudgets() {
  return listPerformanceBudgets as unknown as ReturnType<typeof vi.fn>;
}

function deactivateBudget() {
  return deactivatePerformanceBudget as unknown as ReturnType<typeof vi.fn>;
}

function upsertBudget() {
  return upsertPerformanceBudget as unknown as ReturnType<typeof vi.fn>;
}

function put(body: unknown) {
  return new Request("http://localhost/api/performance-budgets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("/api/performance-budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirst().mockResolvedValue({ id: "proj-1" });
    deactivateBudget().mockResolvedValue({ id: "budget-1", isActive: false });
    listBudgets().mockResolvedValue([]);
    upsertBudget().mockResolvedValue({ id: "budget-1" });
  });

  it("returns organization performance budgets", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(listBudgets()).toHaveBeenCalledWith("org-1", prisma);
  });

  it("upserts an organization default budget", async () => {
    const res = await PUT(put({
      scope: "ORGANIZATION",
      warningCents: 500,
      criticalCents: 1000
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(upsertBudget()).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1",
      scope: "ORGANIZATION",
      warningCents: 500,
      criticalCents: 1000
    });
  });

  it("upserts a project override after validating organization ownership", async () => {
    const res = await PUT(put({
      scope: "PROJECT",
      projectId: "proj-1",
      warningCents: "700",
      criticalCents: "1200"
    }));

    expect(res.status).toBe(200);
    expect(projectFindFirst()).toHaveBeenCalledWith({
      where: { id: "proj-1", organizationId: "org-1", deletedAt: null },
      select: { id: true }
    });
    expect(upsertBudget()).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1",
      scope: "PROJECT",
      projectId: "proj-1",
      warningCents: 700,
      criticalCents: 1200
    });
  });

  it("returns 400 when critical threshold is below warning threshold", async () => {
    const res = await PUT(put({
      scope: "ORGANIZATION",
      warningCents: 1000,
      criticalCents: 500
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(upsertBudget()).not.toHaveBeenCalled();
  });

  it("returns 404 when project override targets another organization", async () => {
    projectFindFirst().mockResolvedValue(null);

    const res = await PUT(put({
      scope: "PROJECT",
      projectId: "proj-other",
      warningCents: 700
    }));

    expect(res.status).toBe(404);
    expect(upsertBudget()).not.toHaveBeenCalled();
  });

  it("clears an organization default budget", async () => {
    const res = await PUT(put({
      scope: "ORGANIZATION",
      clear: true
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deactivateBudget()).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1",
      scope: "ORGANIZATION"
    });
    expect(upsertBudget()).not.toHaveBeenCalled();
  });

  it("clears a project override after validating organization ownership", async () => {
    const res = await PUT(put({
      scope: "PROJECT",
      projectId: "proj-1",
      clear: true
    }));

    expect(res.status).toBe(200);
    expect(projectFindFirst()).toHaveBeenCalledWith({
      where: { id: "proj-1", organizationId: "org-1", deletedAt: null },
      select: { id: true }
    });
    expect(deactivateBudget()).toHaveBeenCalledWith({
      prisma,
      organizationId: "org-1",
      scope: "PROJECT",
      projectId: "proj-1"
    });
    expect(upsertBudget()).not.toHaveBeenCalled();
  });
});

describe("session and input boundary", () => {
  beforeEach(() => { vi.mocked(requireSession).mockResolvedValue({ organizationId: "org-1", userId: "user-1", displayName: "测试" }); });
  it("returns 401 before DB access when no session exists", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new UnauthorizedError());
    expect((await GET()).status).toBe(401);
  });
  it("rejects malformed JSON as 400", async () => {
    expect((await PUT(new Request("http://localhost/api/performance-budgets", { method: "PUT", body: "{" }))).status).toBe(400);
  });
  it.each([null, [], 42])("rejects non-object request %j", async (value) => {
    expect((await PUT(put(value))).status).toBe(400);
  });
  it.each([1.5, "3junk", -10, 2147483648])("rejects invalid cents %j", async (value) => {
    expect((await PUT(put({ scope: "ORGANIZATION", warningCents: value }))).status).toBe(400);
  });
  it("sanitizes storage failures", async () => {
    listBudgets().mockRejectedValueOnce(new Error("postgresql://secret@host/db"));
    const result = await GET();
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain("secret");
  });
});