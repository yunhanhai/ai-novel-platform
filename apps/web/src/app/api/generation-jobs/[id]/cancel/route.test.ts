import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../../../server/context", () => ({ getOrganizationId: vi.fn(async () => "org-1"), isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError" }));
vi.mock("@ai-novel/db", () => ({ prisma: {}, cancelGenerationJob: vi.fn() }));
import { POST } from "./route";
import { getOrganizationId } from "../../../../../server/context";
import { cancelGenerationJob, prisma } from "@ai-novel/db";
const cancel = vi.mocked(cancelGenerationJob);
const ctx = { params: Promise.resolve({ id: "job-1" }) };
const call = () => POST(new Request("http://localhost/api/generation-jobs/job-1/cancel", { method: "POST" }), ctx);
describe("cancel route", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("returns 401 without a session", async () => {
    const error = new Error("未登录"); error.name = "UnauthorizedError";
    vi.mocked(getOrganizationId).mockRejectedValueOnce(error);
    expect((await call()).status).toBe(401); expect(cancel).not.toHaveBeenCalled();
  });
  it("returns 404 for missing or foreign organization jobs", async () => {
    cancel.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect((await call()).status).toBe(404);
    expect(cancel).toHaveBeenCalledWith({ jobId: "job-1", organizationId: "org-1", prisma });
  });
  it("returns conflict when completion wins", async () => {
    cancel.mockResolvedValueOnce({ ok: false, reason: "invalid_status" });
    const response = await call(); expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("任务已结束，无需停止");
  });
  it.each(["queued", "running", "already cancelled"])("returns cancellation success for %s", async () => {
    cancel.mockResolvedValueOnce({ ok: true, job: { id: "job-1", status: "CANCELLED" } });
    const response = await call(); expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ id: "job-1", status: "CANCELLED" });
  });
  it("sanitizes database errors", async () => {
    cancel.mockRejectedValueOnce(new Error("postgres connection details"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try { const response = await call(); expect(response.status).toBe(500); expect((await response.json()).error).toBe("服务器内部错误"); }
    finally { spy.mockRestore(); }
  });
});
