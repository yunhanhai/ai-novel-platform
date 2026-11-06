import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), trends: vi.fn(), budget: vi.fn(), project: vi.fn() }));
vi.mock("@ai-novel/db", () => ({ prisma: { project: { findFirst: mocks.project } } }));
vi.mock("../../../../../server/context", () => ({ requireSession: mocks.session, isUnauthorizedError: (error: Error) => error.name === "UnauthorizedError" }));
vi.mock("../../../../../server/performance-trends", async (original) => ({ ...await original<typeof import("../../../../../server/performance-trends")>(), getPerformanceTrends: mocks.trends }));
vi.mock("../../../../../server/performance-budgets", () => ({ getEffectivePerformanceCostBudget: mocks.budget }));
import { GET } from "./route";
import { prisma } from "@ai-novel/db";
const request = (query = "") => new Request("http://localhost/api/performance-trends" + query);
const context = { params: Promise.resolve({ projectId: "project-1" }) };
describe("session-scoped trends", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: "session-org", userId: "user-1" }); mocks.trends.mockResolvedValue({ totals: { calls: 1 } }); mocks.budget.mockResolvedValue({ scope: "ORGANIZATION", warningCents: 100, criticalCents: 200 }); mocks.project.mockResolvedValue({ id: "project-1" }); });
  it("awaits identity and passes only session organization into budget and aggregation", async () => {
    const response = await GET(request("?window=7d"), context);
    expect(response.status).toBe(200);
    expect(mocks.budget).toHaveBeenCalledWith(expect.objectContaining({ prisma, organizationId: "session-org" }));
    expect(mocks.trends).toHaveBeenCalledWith(expect.objectContaining({ prisma, organizationId: "session-org", window: "7d", costBudget: { scope: "ORGANIZATION", warningCents: 100, criticalCents: 200 } }));
  });
  it("rejects a missing asynchronous session before DB work", async () => {
    mocks.session.mockRejectedValue(Object.assign(new Error("expired"), { name: "UnauthorizedError" }));
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(mocks.trends).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.project).not.toHaveBeenCalled();
  });
  it("authenticates before validating query values", async () => { mocks.session.mockRejectedValue(Object.assign(new Error("expired"), { name: "UnauthorizedError" })); expect((await GET(request("?window=invalid"), context)).status).toBe(401); });
  it("rejects invalid windows", async () => { expect((await GET(request("?window=90d"), context)).status).toBe(400); expect(mocks.trends).not.toHaveBeenCalled(); });
  it("does not expose infrastructure details", async () => { mocks.trends.mockRejectedValue(new Error("postgres://private-host:5432 password")); const response = await GET(request(), context); expect(response.status).toBe(500); expect((await response.json()).error).toBe("服务器内部错误"); });
  it("returns 404 for a project outside the session organization", async () => { mocks.project.mockResolvedValue(null); expect((await GET(request(), context)).status).toBe(404); expect(mocks.project).toHaveBeenCalledWith({ where: { id: "project-1", organizationId: "session-org", deletedAt: null }, select: { id: true } }); expect(mocks.trends).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled(); });
});