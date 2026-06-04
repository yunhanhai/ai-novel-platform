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
    vi.clearAllMocks();
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

  it("does not create USER_KEY adapter when ENCRYPTION_KEY is missing", async () => {
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

    const model = await resolveModel(baseJob);

    expect(model).toBeNull();
    expect(mockCreateAdapter).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ENCRYPTION_KEY"));
  });

  it("skips model profile lookup in fake model mode", async () => {
    const resolveModel = createJobModelResolver({
      prisma: {} as never,
      useFakeModel: true,
      env: {},
      logger: { warn: vi.fn() }
    });

    await expect(resolveModel(baseJob)).resolves.toBeNull();
    expect(mockResolveModelProfile).not.toHaveBeenCalled();
  });

  it("parses a 64 character hex ENCRYPTION_KEY", () => {
    expect(getEncryptionKey({ ENCRYPTION_KEY: "a".repeat(64) })).toEqual(Buffer.from("a".repeat(64), "hex"));
    expect(getEncryptionKey({ ENCRYPTION_KEY: "" })).toBeNull();
  });
});
