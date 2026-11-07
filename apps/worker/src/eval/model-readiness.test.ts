import { encrypt } from "@ai-novel/shared/crypto/encryption";
import { describe, expect, it } from "vitest";
import { assessModelReadiness, canDecryptStoredCredential, buildReadinessProfileFilter } from "./model-readiness";
const provider = { id: "p1", organizationId: "org1", providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", status: "ACTIVE", baseUrl: "https://provider.example/v1", encryptedApiKey: null };
const profile = { id: "m1", organizationId: "org1", projectId: null, providerId: "p1", modelName: "test-model" };
const input = { workerEnv: { USE_FAKE_MODEL: "false", OPENAI_API_KEY: "test-placeholder" }, webEnv: { USE_FAKE_MODEL: "false", OPENAI_API_KEY: "test-placeholder" }, providers: [provider], profiles: [profile] };

describe("read-only model readiness", () => {
  it("accepts PLATFORM_KEY mode without unused master keys", () => {
    expect(assessModelReadiness(input)).toMatchObject({ ready: true, checks: [{ ready: true, profileId: "m1" }] });
  });
  it("reports fake mode and missing credentials without exposing values", () => {
    const result = assessModelReadiness({ ...input, workerEnv: { USE_FAKE_MODEL: "true" }, webEnv: { USE_FAKE_MODEL: "true" } });
    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(["WORKER_FAKE_MODE", "WEB_FAKE_MODE"]));
    expect(result.checks[0]?.issues).toContain("WORKER_API_KEY_MISSING");
    expect(JSON.stringify(result)).not.toContain("test-placeholder");
  });
  it("rejects mismatched master keys for USER_KEY web/worker", () => {
    const result = assessModelReadiness({ ...input, providers: [{ ...provider, authMode: "USER_KEY", encryptedApiKey: "cipher-placeholder" }], workerEnv: { ENCRYPTION_KEY: "a".repeat(64), USE_FAKE_MODEL: "false" }, webEnv: { ENCRYPTION_KEY: "b".repeat(64), USE_FAKE_MODEL: "false" } });
    expect(result.checks[0]?.issues).toContain("ENCRYPTION_KEY_MISMATCH");
    expect(JSON.stringify(result)).not.toContain("cipher-placeholder");
  });
  it("rejects inactive or cross-organization provider associations", () => {
    const result = assessModelReadiness({ ...input, providers: [{ ...provider, status: "DISABLED", organizationId: "other" }] });
    expect(result.checks[0]?.issues).toEqual(expect.arrayContaining(["PROVIDER_DISABLED", "PROVIDER_ORGANIZATION_MISMATCH"]));
  });
  it("rejects unsupported provider and invalid endpoint protocols", () => {
    const result = assessModelReadiness({ ...input, providers: [{ ...provider, providerType: "GEMINI", baseUrl: "file:///local" }] });
    expect(result.checks[0]?.issues).toEqual(expect.arrayContaining(["PROVIDER_UNSUPPORTED", "BASE_URL_INVALID"]));
  });
  it("requires a profile and does not mark an empty database ready", () => {
    expect(assessModelReadiness({ ...input, profiles: [] })).toMatchObject({ ready: false, issues: ["NO_MODEL_PROFILE"] });
  });
});

it("does not accept different platform credentials between web and worker", () => {
  const result = assessModelReadiness({ ...input, webEnv: { ...input.webEnv, OPENAI_API_KEY: "other-placeholder" } });
  expect(result.checks[0]?.issues).toContain("PLATFORM_API_KEY_MISMATCH");
  expect(result.ready).toBe(false);
});
it("checks actual stored credential decryption without returning the plaintext", async () => {
  const hex = "a".repeat(64);
  const cipher = await encrypt("local-only-placeholder", Buffer.from(hex, "hex"));
  expect(await canDecryptStoredCredential(cipher, hex, hex)).toBe(true);
  expect(await canDecryptStoredCredential(cipher, "b".repeat(64), hex)).toBe(false);
  expect(await canDecryptStoredCredential("corrupt", hex, hex)).toBe(false);
});
it("includes organization defaults when preflighting a project's effective candidates", () => {
  expect(buildReadinessProfileFilter({ projectId: "p1" }, { id: "p1", organizationId: "org1" })).toEqual({ organizationId: "org1", OR: [{ projectId: "p1" }, { projectId: null }] });
});