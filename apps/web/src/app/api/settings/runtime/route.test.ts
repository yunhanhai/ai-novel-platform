import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../server/context", () => ({
  getSessionContext: async () => ({ userId: "user-1", organizationId: "org-1", displayName: "测试用户" }),
  isUnauthorizedError: () => false
}));

import { GET } from "./route";

const originalEnv = { ...process.env };

describe("GET /api/settings/runtime", () => {
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("reports fake mode true and encryption configured", async () => {
    process.env.USE_FAKE_MODEL = "true";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const res = await GET();
    const body = await res.json();
    expect(body.data.useFakeModel).toBe(true);
    expect(body.data.encryptionKeyConfigured).toBe(true);
  });

  it("reports fake mode false when env is not 'true' literal", async () => {
    process.env.USE_FAKE_MODEL = "false";
    delete process.env.ENCRYPTION_KEY;
    const res = await GET();
    const body = await res.json();
    expect(body.data.useFakeModel).toBe(false);
    expect(body.data.encryptionKeyConfigured).toBe(false);
  });

  it("rejects malformed encryption key as not configured", async () => {
    process.env.ENCRYPTION_KEY = "not-hex";
    const res = await GET();
    const body = await res.json();
    expect(body.data.encryptionKeyConfigured).toBe(false);
  });
});
