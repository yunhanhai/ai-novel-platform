import type { PrismaClient } from "@ai-novel/db";
import { encrypt } from "@ai-novel/shared/crypto/encryption";
import { describe, expect, it, vi } from "vitest";
import { createHandlers } from "./handlers";
import { createJobModelResolver } from "./model-runtime";
import { createPoller, type GenerationJob } from "./poll";

const job: GenerationJob = {
  id: "job-config-test",
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  jobType: "GENERATE_CHAPTER",
  status: "RUNNING",
  input: {},
  targetEntityType: "CHAPTER",
  targetEntityId: "chapter-1",
  attemptCount: 1,
  maxAttempts: 3
};

const platformProvider = {
  providerType: "OPENAI_COMPATIBLE" as const,
  authMode: "PLATFORM_KEY" as const,
  baseUrl: "https://provider.invalid/v1",
  encryptedApiKey: null as string | null
};

async function runJob(
  provider: typeof platformProvider | Record<string, unknown> | null,
  env: NodeJS.ProcessEnv,
  profileLookupError?: Error
) {
  const findProfile = vi.fn().mockResolvedValue(provider ? { provider, modelName: "test-model" } : null);
  if (profileLookupError) findProfile.mockRejectedValue(profileLookupError);
  const prisma = {
    modelProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: findProfile
    },
    chapter: {
      findFirst: vi.fn().mockResolvedValue({
        id: "chapter-1",
        projectId: "project-1",
        organizationId: "org-1"
      })
    }
  } as unknown as PrismaClient;
  const updateJobStatus = vi.fn().mockResolvedValue({});
  const requeueForRetry = vi.fn().mockResolvedValue({});
  const resolveModel = createJobModelResolver({
    prisma,
    useFakeModel: false,
    env,
    logger: { warn: vi.fn() }
  });
  const poller = createPoller({
    claimNext: async () => job,
    updateJobStatus,
    requeueForRetry,
    pollIntervalMs: 10,
    handlers: createHandlers({ prisma, updateJobStatus, resolveModel, useFakeModel: false })
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const result = await poller.tick();
    return { result, updateJobStatus, requeueForRetry };
  } finally {
    log.mockRestore();
  }
}

describe("model setup errors from resolver through the real handler and poller", () => {
  it.each([
    {
      name: "missing master key",
      provider: { ...platformProvider, authMode: "USER_KEY", encryptedApiKey: "encrypted-test-value" },
      env: {},
      hint: "ENCRYPTION_KEY"
    },
    {
      name: "malformed master key",
      provider: { ...platformProvider, authMode: "USER_KEY", encryptedApiKey: "encrypted-test-value" },
      env: { ENCRYPTION_KEY: "z".repeat(64) },
      hint: "64"
    },
    { name: "missing platform API key", provider: platformProvider, env: {}, hint: "API key" },
    {
      name: "missing stored API key",
      provider: { ...platformProvider, authMode: "USER_KEY" },
      env: { ENCRYPTION_KEY: "a".repeat(64) },
      hint: "API key"
    },
    {
      name: "unsupported provider",
      provider: { ...platformProvider, providerType: "GEMINI" },
      env: { OPENAI_API_KEY: "test-placeholder-not-a-real-key" },
      hint: "供应商"
    }
  ])("fails once with useful guidance for $name", async ({ provider, env, hint }) => {
    const { result, updateJobStatus, requeueForRetry } = await runJob(provider, env);

    expect(result).toBe("error");
    expect(updateJobStatus).toHaveBeenCalledExactlyOnceWith({
      jobId: job.id,
      expectedAttemptCount: 1,
      status: "FAILED",
      errorCode: "MODEL_CONFIG_ERROR",
      errorMessage: expect.stringContaining(hint)
    });
    expect(requeueForRetry).not.toHaveBeenCalled();
  });

  it("distinguishes an incorrect master key from provider authentication failures", async () => {
    const encryptedApiKey = await encrypt("credential-test-placeholder", Buffer.from("a".repeat(64), "hex"));
    const { updateJobStatus, requeueForRetry } = await runJob(
      { ...platformProvider, authMode: "USER_KEY", encryptedApiKey },
      { ENCRYPTION_KEY: "b".repeat(64) }
    );

    expect(updateJobStatus).toHaveBeenCalledExactlyOnceWith({
      jobId: job.id,
      expectedAttemptCount: 1,
      status: "FAILED",
      errorCode: "MODEL_CONFIG_ERROR",
      errorMessage: expect.stringContaining("解密")
    });
    const message = updateJobStatus.mock.calls[0]![0].errorMessage;
    expect(message).not.toContain("credential-test-placeholder");
    expect(message).not.toContain(encryptedApiKey);
    expect(message).not.toContain("Unsupported state");
    expect(requeueForRetry).not.toHaveBeenCalled();
  });

  it("keeps the existing NO_MODEL_PROFILE outcome when no profile is found", async () => {
    const { result, updateJobStatus, requeueForRetry } = await runJob(null, {});

    expect(result).toBe("processed");
    expect(updateJobStatus).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: "FAILED",
      errorCode: "NO_MODEL_PROFILE"
    }));
    expect(requeueForRetry).not.toHaveBeenCalled();
  });

  it("retries a profile lookup outage instead of reporting a broken configuration", async () => {
    const { result, updateJobStatus, requeueForRetry } = await runJob(
      platformProvider,
      {},
      new Error("database temporarily unavailable")
    );

    expect(result).toBe("retried");
    expect(updateJobStatus).not.toHaveBeenCalled();
    expect(requeueForRetry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      jobId: job.id,
      attemptCount: 1,
      errorMessage: "database temporarily unavailable"
    }));
  });
});
