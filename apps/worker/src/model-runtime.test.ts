import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "./poll";

const mockResolveModelProfile = vi.fn();
const mockCreateAdapter = vi.fn();

vi.mock("@ai-novel/model-adapters", () => ({
  resolveModelProfile: (...args: unknown[]) => mockResolveModelProfile(...args),
  createAdapter: (...args: unknown[]) => mockCreateAdapter(...args)
}));

import { createJobModelResolver, getEncryptionKey } from "./model-runtime";

const baseJob: GenerationJob = {
  id: "job-1",
  organizationId: "org-1",
  projectId: "proj-1",
  userId: "user-1",
  jobType: "GENERATE_CHAPTER",
  status: "RUNNING",
  input: {},
  targetEntityType: "CHAPTER",
  targetEntityId: "chapter-1"
};

const platformProvider = {
  providerType: "OPENAI_COMPATIBLE" as const,
  authMode: "PLATFORM_KEY" as const,
  baseUrl: "https://api.example.com/v1",
  encryptedApiKey: null
};

describe("model-runtime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves PLATFORM_KEY model without requiring ENCRYPTION_KEY", async () => {
    const adapter = {
      generate: vi.fn().mockResolvedValue({ text: "ok", inputTokens: 1, outputTokens: 1 }),
      modelName: "gpt-5.5",
      providerType: "OPENAI_COMPATIBLE"
    };
    mockResolveModelProfile.mockResolvedValue({
      provider: platformProvider,
      modelName: "gpt-5.5"
    });
    mockCreateAdapter.mockResolvedValue(adapter);

    const env = { OPENAI_API_KEY: "sk-test" };
    const logger = { warn: vi.fn() };
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: false,
      env,
      logger
    });

    const model = await resolveModel(baseJob);

    expect(model).not.toBeNull();
    expect(mockCreateAdapter).toHaveBeenCalledWith(
      platformProvider,
      "gpt-5.5",
      expect.objectContaining({ encryptionKey: null, env })
    );
    await expect(model?.generate("hello")).resolves.toEqual({ text: "ok", inputTokens: 1, outputTokens: 1 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ignores an invalid but unused ENCRYPTION_KEY in PLATFORM_KEY mode", async () => {
    const adapter = { generate: vi.fn().mockResolvedValue({ text: "ok", inputTokens: 1, outputTokens: 1 }) };
    mockResolveModelProfile.mockResolvedValue({ provider: platformProvider, modelName: "gpt-test" });
    mockCreateAdapter.mockResolvedValue(adapter);
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: false,
      env: { ENCRYPTION_KEY: "invalid-but-unused", OPENAI_API_KEY: "test-placeholder" },
      logger: { warn: vi.fn() }
    });

    await expect(resolveModel(baseJob)).resolves.toMatchObject({
      modelName: "gpt-test",
      billingSource: "PLATFORM"
    });
    expect(mockCreateAdapter).toHaveBeenCalledWith(
      platformProvider,
      "gpt-test",
      expect.objectContaining({ encryptionKey: null })
    );
  });

  it("reports a missing ENCRYPTION_KEY instead of treating the profile as missing", async () => {
    mockResolveModelProfile.mockResolvedValue({
      provider: { ...platformProvider, authMode: "USER_KEY", encryptedApiKey: "enc-key" },
      modelName: "gpt-5.5"
    });
    const logger = { warn: vi.fn() };
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: false,
      env: {},
      logger
    });

    await expect(resolveModel(baseJob)).rejects.toThrow("ENCRYPTION_KEY_NOT_RESOLVED");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("returns null when no model profile exists", async () => {
    mockResolveModelProfile.mockResolvedValue(null);
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: false,
      env: {},
      logger: { warn: vi.fn() }
    });

    await expect(resolveModel(baseJob)).resolves.toBeNull();
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it.each([
    { modelName: "gpt-test" },
    { provider: platformProvider, modelName: "" },
    { provider: platformProvider, modelName: "   " },
    { provider: platformProvider, modelName: 42 }
  ])("reports an incomplete profile before creating an adapter: %j", async (profile) => {
    mockResolveModelProfile.mockResolvedValue(profile);
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: false,
      env: {},
      logger: { warn: vi.fn() }
    });

    await expect(resolveModel(baseJob)).rejects.toThrow("MODEL_PROFILE_INVALID");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("reports a malformed encryption key before creating a USER_KEY adapter", async () => {
    mockResolveModelProfile.mockResolvedValue({
      provider: { ...platformProvider, authMode: "USER_KEY", encryptedApiKey: "encrypted-test-value" },
      modelName: "gpt-test"
    });
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: false,
      env: { ENCRYPTION_KEY: "z".repeat(64) },
      logger: { warn: vi.fn() }
    });

    await expect(resolveModel(baseJob)).rejects.toThrow("ENCRYPTION_KEY_INVALID");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it.each([
    "API_KEY_NOT_RESOLVED: OPENAI_API_KEY not set",
    "UNSUPPORTED_PROVIDER: GEMINI not implemented in phase 1",
    "unexpected adapter failure"
  ])("preserves adapter errors so the poller can classify them: %s", async (message) => {
    mockResolveModelProfile.mockResolvedValue({ provider: platformProvider, modelName: "gpt-test" });
    const error = new Error(message);
    mockCreateAdapter.mockRejectedValue(error);
    const logger = { warn: vi.fn() };
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: false,
      env: {},
      logger
    });

    await expect(resolveModel(baseJob)).rejects.toBe(error);
  });

  it("skips model profile lookup in fake model mode", async () => {
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: true,
      env: { ENCRYPTION_KEY: "malformed-but-unused-in-fake-mode" },
      logger: { warn: vi.fn() }
    });

    await expect(resolveModel(baseJob)).resolves.toBeNull();
    expect(mockResolveModelProfile).not.toHaveBeenCalled();
  });

  it("parses a 64 character hex ENCRYPTION_KEY", () => {
    expect(getEncryptionKey({ ENCRYPTION_KEY: "a".repeat(64) })).toEqual(Buffer.from("a".repeat(64), "hex"));
    expect(getEncryptionKey({ ENCRYPTION_KEY: "AB".repeat(32) })).toEqual(Buffer.from("AB".repeat(32), "hex"));
    expect(getEncryptionKey({ ENCRYPTION_KEY: "" })).toBeNull();
  });

  it.each([
    "a".repeat(63),
    "a".repeat(65),
    "a".repeat(64) + "ignored-suffix",
    "a".repeat(62) + "zz",
    "z".repeat(64)
  ])("rejects malformed encryption keys without truncating or partially decoding: %s", (key) => {
    expect(getEncryptionKey({ ENCRYPTION_KEY: key })).toBeNull();
  });
});

it("honors profile tuning, caps step output and gates structured output by profile capability", async () => {
  const adapter = { generate: vi.fn().mockResolvedValue({ text: "{}", inputTokens: 3, outputTokens: 3 }) };
  mockResolveModelProfile.mockResolvedValue({ provider: platformProvider, modelName: "step-test", temperature: { toString: () => "0.5" }, topP: 0.9, maxOutputTokens: 2048, settings: { reasoningEffort: "low", jsonMode: true, apiKey: "ignored" } });
  mockCreateAdapter.mockResolvedValue(adapter);
  const model = await createJobModelResolver({ prisma: {} as never, useFakeModel: false, env: {} })(baseJob);
  const signal = new AbortController().signal;
  await model!.generate("json", { maxOutputTokens: 4096, responseFormat: "json_object", signal, maxRetries: 0 } as never);
  expect(adapter.generate).toHaveBeenLastCalledWith("json", expect.objectContaining({ temperature: 0.5, topP: 0.9, maxOutputTokens: 2048, reasoningEffort: "low", responseFormat: "json_object", signal, maxRetries: 0 }));
  await model!.generate("draft", { maxOutputTokens: 1024 });
  expect(adapter.generate.mock.calls.at(-1)?.[1]).toMatchObject({ maxOutputTokens: 1024 });
  expect(adapter.generate.mock.calls.at(-1)?.[1]).not.toHaveProperty("responseFormat");
  expect(adapter.generate.mock.calls.at(-1)?.[1]).not.toHaveProperty("apiKey");
  mockResolveModelProfile.mockResolvedValue({ provider: platformProvider, modelName: "legacy" });
  const legacy = await createJobModelResolver({ prisma: {} as never, useFakeModel: false, env: {} })(baseJob);
  await legacy!.generate("json", { responseFormat: "json_object" } as never);
  expect(adapter.generate.mock.calls.at(-1)?.[1]).not.toHaveProperty("responseFormat");
});
