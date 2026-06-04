import { describe, test, expect, vi, beforeEach } from "vitest";
import type { ModelAdapter } from "./types";
import type { ProviderRecord, AdapterFactoryDeps } from "./adapter-factory";

const mockDecrypt = vi.fn(async (encoded: string, _key: Buffer) => `decrypted:${encoded}`);

vi.mock("@ai-novel/shared/crypto/encryption", () => ({
  decrypt: (encoded: string, _key: Buffer) => mockDecrypt(encoded, _key)
}));

const mockOpenAIAdapter: ModelAdapter = {
  generate: vi.fn(),
  modelName: "mock-openai",
  providerType: "OPENAI_COMPATIBLE"
};

const mockAnthropicAdapter: ModelAdapter = {
  generate: vi.fn(),
  modelName: "mock-anthropic",
  providerType: "ANTHROPIC"
};

const mockCreateOpenAIAdapter = vi.fn(() => mockOpenAIAdapter);
const mockCreateAnthropicAdapter = vi.fn(() => mockAnthropicAdapter);

vi.mock("./openai-adapter", () => ({
  createOpenAIAdapter: (...args: Parameters<typeof mockCreateOpenAIAdapter>) => mockCreateOpenAIAdapter(...args)
}));

vi.mock("./anthropic-adapter", () => ({
  createAnthropicAdapter: (...args: Parameters<typeof mockCreateAnthropicAdapter>) => mockCreateAnthropicAdapter(...args)
}));

import { createAdapter } from "./adapter-factory";

const encKey = Buffer.from("A".repeat(64), "hex");

function makeProvider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    providerType: "OPENAI_COMPATIBLE",
    authMode: "USER_KEY",
    baseUrl: null,
    encryptedApiKey: "enc-test-key",
    ...overrides
  };
}

describe("adapter-factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Case 1
  test("USER_KEY: decrypts encryptedApiKey and passes it to the adapter", async () => {
    const adapter = await createAdapter(makeProvider(), "gpt-4o", { encryptionKey: encKey });

    expect(mockDecrypt).toHaveBeenCalledWith("enc-test-key", encKey);
    expect(mockCreateOpenAIAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "decrypted:enc-test-key" })
    );
    expect(adapter).toBe(mockOpenAIAdapter);
  });

  test("USER_KEY without ENCRYPTION_KEY throws before decrypting", async () => {
    await expect(
      createAdapter(makeProvider(), "gpt-4o", {})
    ).rejects.toThrow("ENCRYPTION_KEY_NOT_RESOLVED");

    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockCreateOpenAIAdapter).not.toHaveBeenCalled();
  });

  // Case 2
  test("PLATFORM_KEY + ANTHROPIC: uses ANTHROPIC_API_KEY from env", async () => {
    await createAdapter(
      makeProvider({ providerType: "ANTHROPIC", authMode: "PLATFORM_KEY", encryptedApiKey: null }),
      "claude-haiku",
      { encryptionKey: encKey, env: { ANTHROPIC_API_KEY: "sk-ant-foo" } }
    );

    expect(mockCreateAnthropicAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-ant-foo" })
    );
  });

  test("PLATFORM_KEY + ANTHROPIC without env → throws API_KEY_NOT_RESOLVED", async () => {
    await expect(
      createAdapter(
        makeProvider({ providerType: "ANTHROPIC", authMode: "PLATFORM_KEY", encryptedApiKey: null }),
        "claude-haiku",
        { encryptionKey: encKey, env: {} }
      )
    ).rejects.toThrow("API_KEY_NOT_RESOLVED");
  });

  // Case 3
  test("PLATFORM_KEY + OPENAI_COMPATIBLE: uses OPENAI_API_KEY from env", async () => {
    await createAdapter(
      makeProvider({ providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", encryptedApiKey: null }),
      "gpt-4o",
      { encryptionKey: encKey, env: { OPENAI_API_KEY: "sk-openai-foo" } }
    );

    expect(mockCreateOpenAIAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-openai-foo" })
    );
  });

  test("PLATFORM_KEY + OPENAI_COMPATIBLE without env → throws API_KEY_NOT_RESOLVED", async () => {
    await expect(
      createAdapter(
        makeProvider({ providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", encryptedApiKey: null }),
        "gpt-4o",
        { encryptionKey: encKey, env: {} }
      )
    ).rejects.toThrow("API_KEY_NOT_RESOLVED");
  });

  // Case 4
  test("routes ANTHROPIC providerType to createAnthropicAdapter", async () => {
    await createAdapter(
      makeProvider({ providerType: "ANTHROPIC" }),
      "claude-haiku",
      { encryptionKey: encKey }
    );

    expect(mockCreateAnthropicAdapter).toHaveBeenCalled();
  });

  // Case 5
  test.each(["OPENAI_COMPATIBLE", "DEEPSEEK", "CUSTOM"] as const)(
    "routes %s providerType to createOpenAIAdapter with baseUrl", async (providerType) => {
      await createAdapter(
        makeProvider({ providerType, baseUrl: "https://api.example.com/v1" }),
        "test-model",
        { encryptionKey: encKey }
      );

      expect(mockCreateOpenAIAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "https://api.example.com/v1" })
      );
    }
  );

  // Case 6
  test("GEMINI throws UNSUPPORTED_PROVIDER", async () => {
    await expect(
      createAdapter(makeProvider({ providerType: "GEMINI" }), "gemini-pro", { encryptionKey: encKey })
    ).rejects.toThrow("UNSUPPORTED_PROVIDER");
  });

  // Case 7
  test("USER_KEY with null encryptedApiKey throws API_KEY_NOT_RESOLVED", async () => {
    await expect(
      createAdapter(
        makeProvider({ authMode: "USER_KEY", encryptedApiKey: null }),
        "gpt-4o",
        { encryptionKey: encKey }
      )
    ).rejects.toThrow("API_KEY_NOT_RESOLVED");
  });

  // DEEPSEEK/CUSTOM use OPENAI_API_KEY env
  test("PLATFORM_KEY + DEEPSEEK: uses OPENAI_API_KEY from env", async () => {
    await createAdapter(
      makeProvider({ providerType: "DEEPSEEK", authMode: "PLATFORM_KEY", encryptedApiKey: null }),
      "deepseek-chat",
      { encryptionKey: encKey, env: { OPENAI_API_KEY: "sk-deepseek-foo" } }
    );

    expect(mockCreateOpenAIAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-deepseek-foo" })
    );
  });
});
