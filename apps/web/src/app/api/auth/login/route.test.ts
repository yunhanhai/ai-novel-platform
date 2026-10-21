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
import { LOGIN_POLICY, resetRateLimitsForTests } from "../../../../server/rate-limit";

const vp = () => verifyPassword as unknown as ReturnType<typeof vi.fn>;
const fu = () => findUserByEmail as unknown as ReturnType<typeof vi.fn>;
const fo = () => findOrganizationsByUserId as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

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

  it("locks out the account after too many failed attempts", async () => {
    fu().mockResolvedValue({ id: "u", email: "a@b.com", passwordHash: "hash", displayName: "U" });
    vp().mockResolvedValue(false);

    for (let i = 0; i < LOGIN_POLICY.maxFailures; i += 1) {
      const res = await POST(req({ email: "a@b.com", password: "wrong" }));
      expect(res.status).toBe(401);
    }

    const blocked = await POST(req({ email: "a@b.com", password: "wrong" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();

    // 锁定期内即使密码正确也直接拒绝，避免绕过限流继续试探
    vp().mockResolvedValue(true);
    const stillBlocked = await POST(req({ email: "a@b.com", password: "correct" }));
    expect(stillBlocked.status).toBe(429);
  });

  it("clears the failure counter after a successful login", async () => {
    fu().mockResolvedValue({ id: "u", email: "a@b.com", passwordHash: "hash", displayName: "U" });
    vp().mockResolvedValue(false);
    fo().mockResolvedValue([{ id: "org-1" }]);

    for (let i = 0; i < LOGIN_POLICY.maxFailures - 1; i += 1) {
      await POST(req({ email: "a@b.com", password: "wrong" }));
    }

    vp().mockResolvedValue(true);
    const ok = await POST(req({ email: "a@b.com", password: "correct" }));
    expect(ok.status).toBe(200);

    vp().mockResolvedValue(false);
    const after = await POST(req({ email: "a@b.com", password: "wrong" }));
    expect(after.status).toBe(401);
  });

  it("does not reveal whether the account exists", async () => {
    fu().mockResolvedValue(null);
    const missing = await POST(req({ email: "nobody@b.com", password: "x" }));
    const missingBody = (await missing.json()) as { error: string };

    fu().mockResolvedValue({ id: "u", email: "a@b.com", passwordHash: "hash", displayName: "U" });
    vp().mockResolvedValue(false);
    const wrong = await POST(req({ email: "a@b.com", password: "x" }));
    const wrongBody = (await wrong.json()) as { error: string };

    expect(missingBody.error).toBe(wrongBody.error);
  });
});
