import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("@ai-novel/db", () => ({
  prisma: { generationJob: { findFirst: vi.fn(), update: vi.fn() } }
}));

import { POST } from "./route";
import { getOrganizationId } from "../../../../../server/context";
import { prisma } from "@ai-novel/db";

function p() {
  return prisma as unknown as {
    generationJob: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
}

const ctx = { params: Promise.resolve({ id: "job-1" }) };

function call() {
  return POST(new Request("http://localhost/api/generation-jobs/job-1/cancel", { method: "POST" }), ctx);
}

describe("POST /api/generation-jobs/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not signed in", async () => {
    const unauthorized = new Error("未登录");
    unauthorized.name = "UnauthorizedError";
    vi.mocked(getOrganizationId).mockRejectedValueOnce(unauthorized);

    const res = await call();
    expect(res.status).toBe(401);
  });

  it("returns 404 for a job in another organization", async () => {
    p().generationJob.findFirst.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(p().generationJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", organizationId: "org-1" } })
    );
  });

  it("rejects cancelling a finished job", async () => {
    p().generationJob.findFirst.mockResolvedValue({ id: "job-1", status: "SUCCEEDED" });

    const res = await call();

    expect(res.status).toBe(400);
    expect(p().generationJob.update).not.toHaveBeenCalled();
  });

  it("cancels a queued job", async () => {
    p().generationJob.findFirst.mockResolvedValue({ id: "job-1", status: "QUEUED" });
    p().generationJob.update.mockResolvedValue({});

    const res = await call();
    const body = (await res.json()) as { data: { status: string } };

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("CANCELLED");
    expect(p().generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "CANCELLED", errorCode: "CANCELLED_BY_USER" })
      })
    );
  });

  it("marks a running job as cancelled so the batch handler stops at the next chapter", async () => {
    p().generationJob.findFirst.mockResolvedValue({ id: "job-1", status: "RUNNING" });
    p().generationJob.update.mockResolvedValue({});

    const res = await call();

    expect(res.status).toBe(200);
    expect(p().generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) })
    );
  });
});
