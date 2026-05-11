import { describe, test, expect, vi, beforeEach } from "vitest";
import type { ModelAdapter } from "./types";

const mockChatCreate = vi.fn();
let capturedBaseURL: string | undefined;
let capturedApiKey: string | undefined;

interface MockClient { chat: { completions: { create: ReturnType<typeof vi.fn> } } }

vi.mock("openai", () => ({
  default: vi.fn(function (this: MockClient, config: { apiKey: string; baseURL?: string }) {
    capturedBaseURL = config.baseURL;
    capturedApiKey = config.apiKey;
    this.chat = {
      completions: {
        create: mockChatCreate
      }
    };
  })
}));

import { createOpenAIAdapter } from "./openai-adapter";

function newAdapter(opts?: { apiKey?: string; baseUrl?: string; modelName?: string; providerType?: string }): ModelAdapter {
  return createOpenAIAdapter({
    apiKey: opts?.apiKey ?? "sk-test",
    baseUrl: opts?.baseUrl,
    modelName: opts?.modelName ?? "gpt-4o-mini",
    providerType: opts?.providerType ?? "OPENAI_COMPATIBLE"
  });
}

function mockResponse(overrides: { text?: string; promptTokens?: number; completionTokens?: number } = {}) {
  mockChatCreate.mockResolvedValue({
    choices: [{ message: { content: overrides.text ?? "hello" } }],
    usage: {
      prompt_tokens: overrides.promptTokens ?? 10,
      completion_tokens: overrides.completionTokens ?? 5
    }
  });
}

function mockResponseNoUsage(text: string) {
  mockChatCreate.mockResolvedValue({
    choices: [{ message: { content: text } }]
    // no usage field
  });
}

describe("openai-adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedBaseURL = undefined;
    capturedApiKey = undefined;
  });

  // Case 1
  test("calling generate returns a ModelResult with text, inputTokens, and outputTokens", async () => {
    mockResponse({ text: "测试正文", promptTokens: 100, completionTokens: 50 });
    const adapter = newAdapter();

    const result = await adapter.generate("写一章小说");

    expect(result.text).toBe("测试正文");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  // Case 2
  test("passes temperature, topP, and maxOutputTokens to the SDK call", async () => {
    mockResponse();
    const adapter = newAdapter();

    await adapter.generate("prompt", { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 });

    const callArgs = mockChatCreate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.top_p).toBe(0.9);
    expect(callArgs.max_tokens).toBe(2048);
  });

  // Case 3
  test("passes baseUrl to the OpenAI constructor", () => {
    mockResponse();
    newAdapter({ baseUrl: "https://api.deepseek.com/v1" });

    expect(capturedBaseURL).toBe("https://api.deepseek.com/v1");
  });

  // Case 4
  test("injects modelName into the chat.completions.create request", async () => {
    mockResponse();
    const adapter = newAdapter({ modelName: "deepseek-chat" });

    await adapter.generate("hi");

    const callArgs = mockChatCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("deepseek-chat");
  });

  // Case 5
  test("re-throws when the SDK throws", async () => {
    mockChatCreate.mockRejectedValue(new Error("rate limit"));

    const adapter = newAdapter();
    await expect(adapter.generate("prompt")).rejects.toThrow("rate limit");
  });

  // Case 6
  test("falls back to 0 tokens when the response has no usage field", async () => {
    mockResponseNoUsage("fallback text");

    const adapter = newAdapter();
    const result = await adapter.generate("prompt");

    expect(result.text).toBe("fallback text");
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  // Edge: no content in choices
  test("returns empty text when choices are empty", async () => {
    mockChatCreate.mockResolvedValue({
      choices: []
    });

    const adapter = newAdapter();
    const result = await adapter.generate("prompt");

    expect(result.text).toBe("");
  });

  // Properties
  test("exposes modelName and providerType", () => {
    const adapter = newAdapter({ modelName: "gpt-4o", providerType: "OPENAI_COMPATIBLE" });

    expect(adapter.modelName).toBe("gpt-4o");
    expect(adapter.providerType).toBe("OPENAI_COMPATIBLE");
  });
});
