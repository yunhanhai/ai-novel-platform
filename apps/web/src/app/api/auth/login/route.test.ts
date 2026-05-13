import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-novel/db", () => ({ prisma: {} }));

vi.mock("@ai-novel/shared/auth/password", () => ({
  verifyPassword: vi.fn()
}));

vi.mock("../../../../server/auth", () => ({
  setSessionCookie: vi.fn()
}));

vi.mock("../../../../server/users", () => ({
  findUserByEmail: vi.fn()
}));

vi.mock("../../../../server/organizations", () => ({
  findOrganizationsByUserId: vi.fn()
}));

import { POST } from "./route";
import { verifyPassword } from "@ai-novel/shared/auth/password";
import { findUserByEmail } from "../../../../server/users";
import { findOrganizationsByUserId } from "../../../../server/organizations";

const vp = () => verifyPassword as unknown as ReturnType<typeof vi.fn>;
const fu = () => findUserByEmail as unknown as ReturnType<typeof vi.fn>;
const fo = () => findOrganizationsByUserId as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/auth/login", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function req(body: Record<string, unknown>) {
    return new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify(body) });
  }

  it("returns 400 when email or password missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 401 when user not found", async () => {
    fu().mockResolvedValue(null);
    const res = await POST(req({ email: "a@b.com", password: "123456" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when password incorrect", async () => {
    fu().mockResolvedValue({ id: "u", email: "a@b.com", passwordHash: "hash", displayName: "U" });
    vp().mockResolvedValue(false);
    const res = await POST(req({ email: "a@b.com", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 on successful login", async () => {
    fu().mockResolvedValue({ id: "u-1", email: "a@b.com", passwordHash: "hash", displayName: "测试" });
    vp().mockResolvedValue(true);
    fo().mockResolvedValue([{ id: "org-1" }]);
    const res = await POST(req({ email: "a@b.com", password: "correct" }));
    expect(res.status).toBe(200);
  });
});
