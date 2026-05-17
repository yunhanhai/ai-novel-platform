import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./auth";

// 设置 SESSION_SECRET 以通过 getSecret() 校验
process.env.SESSION_SECRET = "test-secret-key-that-is-long-enough-12345678";

describe("auth", () => {
  it("signs and verifies a session token", async () => {
    const token = await signSession({
      userId: "user-1",
      organizationId: "org-1",
      displayName: "测试用户"
    });

    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-1");
    expect(payload!.organizationId).toBe("org-1");
    expect(payload!.displayName).toBe("测试用户");
  });

  it("rejects tampered token", async () => {
    const token = await signSession({ userId: "u", organizationId: "o", displayName: "d" });
    const tampered = token.slice(0, -4) + "xxxx";
    expect(await verifySession(tampered)).toBeNull();
  });

  it("accepts a freshly-signed token (sanity check for exp flow)", async () => {
    const token = await signSession({ userId: "u", organizationId: "o", displayName: "d" });
    expect(await verifySession(token)).not.toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifySession("")).toBeNull();
    expect(await verifySession("not.a.token")).toBeNull();
    expect(await verifySession("a.b.c")).toBeNull();
  });
});
