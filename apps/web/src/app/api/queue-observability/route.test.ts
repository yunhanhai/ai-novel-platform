import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), queue: vi.fn(), recover: vi.fn(), audit: vi.fn(), transaction: vi.fn(), tx: { auditLog: { create: vi.fn() }, generationJob: {} } }));
vi.mock("@ai-novel/db", () => ({ recoverExpiredJobLeases: mocks.recover, prisma: { $transaction: mocks.transaction } }));
vi.mock("../../../server/context", () => ({ requireSession: mocks.session, isUnauthorizedError: (e: Error) => e.name === "UnauthorizedError" }));
vi.mock("../../../server/audit-log", () => ({ recordAuditLog: mocks.audit }));
vi.mock("../../../server/queue-observability", () => ({ getQueueObservability: mocks.queue }));
import { prisma } from "@ai-novel/db";
import { GET, POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/queue-observability", { method: "POST", body: JSON.stringify(body) });
describe("session-scoped queue operations", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: "session-org", userId: "user-1" }); mocks.queue.mockResolvedValue({ totals: { total: 1 } }); mocks.recover.mockResolvedValue({ recovered: 2, failed: 1 }); mocks.transaction.mockImplementation((fn) => fn(mocks.tx)); });
  it("awaits the session for reads", async () => { expect((await GET()).status).toBe(200); expect(mocks.queue).toHaveBeenCalledWith({ prisma, organizationId: "session-org" }); });
  it("returns 401 without touching database when session expires", async () => { mocks.session.mockRejectedValue(Object.assign(new Error("expired"), { name: "UnauthorizedError" })); expect((await GET()).status).toBe(401); expect((await POST(request({ action: "recover-expired-leases" }))).status).toBe(401); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled(); });
  it("recovers and audits in the same transaction using the session actor", async () => { const response = await POST(request({ action: "recover-expired-leases", organizationId: "forged" })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ data: { recovered: 2, failed: 1 } }); expect(mocks.transaction).toHaveBeenCalledOnce(); expect(mocks.recover).toHaveBeenCalledWith({ prisma: mocks.tx, organizationId: "session-org" }); expect(mocks.audit).toHaveBeenCalledWith({ prisma: mocks.tx, organizationId: "session-org", actorUserId: "user-1", action: "queue.recover_expired_leases", entityType: "queue", metadata: { recovered: 2, failed: 1 } }); });
  it("propagates audit failure out of the transaction for rollback", async () => { mocks.audit.mockRejectedValue(new Error("audit DB unavailable")); expect((await POST(request({ action: "recover-expired-leases" }))).status).toBe(500); expect(mocks.transaction).toHaveBeenCalledOnce(); });
  it("rejects malformed JSON and unknown operations", async () => { expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400); expect((await POST(request({ action: "retry" }))).status).toBe(400); expect(mocks.transaction).not.toHaveBeenCalled(); });
});