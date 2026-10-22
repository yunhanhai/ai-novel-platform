import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("../../../../../server/chapters", () => ({
  createVolume: vi.fn(),
  findVolumesByProject: vi.fn()
}));

vi.mock("@ai-novel/db", () => ({
  prisma: { volume: { findFirst: vi.fn() } }
}));

import { GET, POST } from "./route";
import { createVolume, findVolumesByProject } from "../../../../../server/chapters";
import { prisma } from "@ai-novel/db";

function fv() {
  return findVolumesByProject as unknown as ReturnType<typeof vi.fn>;
}
function cv() {
  return createVolume as unknown as ReturnType<typeof vi.fn>;
}
function pv() {
  return (prisma as unknown as { volume: { findFirst: ReturnType<typeof vi.fn> } }).volume;
}

const ctx = { params: Promise.resolve({ projectId: "p-1" }) };

function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/projects/p-1/volumes", { method: "POST", body: JSON.stringify(body) }), ctx);
}

describe("GET /api/projects/[projectId]/volumes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists volumes for the project", async () => {
    fv().mockResolvedValue([
      { id: "v-1", title: "第一卷", summary: null, orderIndex: 1, status: "PLANNED", createdAt: new Date() }
    ]);

    const res = await GET(new Request("http://localhost/api/projects/p-1/volumes"), ctx);
    const body = (await res.json()) as { data: Array<{ title: string }> };

    expect(res.status).toBe(200);
    expect(body.data[0]!.title).toBe("第一卷");
  });
});

describe("POST /api/projects/[projectId]/volumes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a blank title", async () => {
    const res = await post({ title: "   " });
    expect(res.status).toBe(400);
    expect(cv()).not.toHaveBeenCalled();
  });

  it("appends the volume after the current last order index", async () => {
    pv().findFirst.mockResolvedValue({ orderIndex: 3 });
    cv().mockResolvedValue({ id: "v-4", title: "第四卷", summary: null, orderIndex: 4, status: "PLANNED", createdAt: new Date() });

    const res = await post({ title: "第四卷" });

    expect(res.status).toBe(201);
    expect(cv()).toHaveBeenCalledWith(expect.objectContaining({ title: "第四卷", orderIndex: 4 }));
  });

  it("starts at order index 1 for the first volume", async () => {
    pv().findFirst.mockResolvedValue(null);
    cv().mockResolvedValue({ id: "v-1", title: "第一卷", summary: null, orderIndex: 1, status: "PLANNED", createdAt: new Date() });

    await post({ title: "第一卷" });

    expect(cv()).toHaveBeenCalledWith(expect.objectContaining({ orderIndex: 1 }));
  });

  it("retries once with a fresh order index when a concurrent insert wins the race", async () => {
    // 两个并发请求读到同一个最大值 → 第二个撞 P2002，应重算后重试
    pv().findFirst
      .mockResolvedValueOnce({ orderIndex: 1 })
      .mockResolvedValueOnce({ orderIndex: 2 });
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    cv()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ id: "v-3", title: "第三卷", summary: null, orderIndex: 3, status: "PLANNED", createdAt: new Date() });

    const res = await post({ title: "第三卷" });

    expect(res.status).toBe(201);
    expect(cv()).toHaveBeenCalledTimes(2);
    expect(cv().mock.calls[1]![0]).toMatchObject({ orderIndex: 3 });
  });

  it("reports a conflict when the retry also fails", async () => {
    pv().findFirst.mockResolvedValue({ orderIndex: 1 });
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    cv().mockRejectedValue(conflict);

    const res = await post({ title: "重复卷" });

    expect(res.status).toBe(409);
    expect(cv()).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the client pinned an explicit order index", async () => {
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    cv().mockRejectedValueOnce(conflict);

    const res = await post({ title: "重复卷", orderIndex: 1 });

    expect(res.status).toBe(409);
    expect(cv()).toHaveBeenCalledTimes(1);
  });
});
