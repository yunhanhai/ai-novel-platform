import { describe, test, expect, vi, beforeEach } from "vitest";
import type { ModelAdapter } from "./types";

const mockMessagesCreate = vi.fn();

interface MockClient { messages: { create: ReturnType<typeof vi.fn> } }

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function (this: MockClient) {
    this.messages = {
      create: mockMessagesCreate
    };
  })
}));

import { createAnthropicAdapter } from "./anthropic-adapter";

function newAdapter(opts?: { apiKey?: string; modelName?: string; providerType?: string }): ModelAdapter {
  return createAnthropicAdapter({
    apiKey: opts?.apiKey ?? "sk-ant-test",
    modelName: opts?.modelName ?? "claude-haiku-4-5-20251001",
    providerType: opts?.providerType ?? "ANTHROPIC"
  });
}

function mockTextResponse(text: string, inputTokens = 100, outputTokens = 50) {
  mockMessagesCreate.mockResolvedValue({
    content: [{ type: "text", text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  });
}

function mockMultiBlockResponse(blocks: { type: string; text?: string }[], inputTokens = 100, outputTokens = 50) {
  mockMessagesCreate.mockResolvedValue({
    content: blocks,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  });
}

describe("anthropic-adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Case 1
  test("calling generate returns a ModelResult with text, inputTokens, and outputTokens", async () => {
    mockTextResponse("这是测试正文", 200, 80);
    const adapter = newAdapter();

    const result = await adapter.generate("写一章小说");

    expect(result.text).toBe("这是测试正文");
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(80);
  });

  // Case 2
  test("concatenates multiple text blocks from a multi-part response", async () => {
    mockMultiBlockResponse([
      { type: "text", text: "第一段。" },
      { type: "text", text: "第二段。" },
      { type: "text", text: "第三段。" }
    ]);

    const adapter = newAdapter();
    const result = await adapter.generate("prompt");

    expect(result.text).toBe("第一段。第二段。第三段。");
  });

  // Case 3
  test("parses usage.input_tokens and usage.output_tokens", async () => {
    mockTextResponse("content", 350, 120);
    const adapter = newAdapter();

    const result = await adapter.generate("prompt");

    expect(result.inputTokens).toBe(350);
    expect(result.outputTokens).toBe(120);
  });

  // Case 4
  test("passes temperature, topP, and maxOutputTokens to messages.create", async () => {
    mockTextResponse("x");
    const adapter = newAdapter();

    await adapter.generate("prompt", { temperature: 0.8, topP: 0.95, maxOutputTokens: 8192 });

    const callArgs = mockMessagesCreate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.8);
    expect(callArgs.top_p).toBe(0.95);
    expect(callArgs.max_tokens).toBe(8192);
  });

  // Case 5
  test("defaults to 4096 max_tokens when maxOutputTokens is not provided", async () => {
    mockTextResponse("x");
    const adapter = newAdapter();

    await adapter.generate("prompt");

    const callArgs = mockMessagesCreate.mock.calls[0][0];
    expect(callArgs.max_tokens).toBe(4096);
  });

  // Case 6
  test("re-throws when the SDK throws", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("rate limit"));

    const adapter = newAdapter();
    await expect(adapter.generate("prompt")).rejects.toThrow("rate limit");
  });

  // Edge: non-text blocks are filtered out
  test("filters out non-text content blocks", async () => {
    mockMultiBlockResponse([
      { type: "tool_use" },
      { type: "text", text: "有效文本" },
      { type: "thinking" }
    ]);

    const adapter = newAdapter();
    const result = await adapter.generate("prompt");

    expect(result.text).toBe("有效文本");
  });

  // Properties
  test("exposes modelName and providerType", () => {
    const adapter = newAdapter({ modelName: "claude-opus-4-7", providerType: "ANTHROPIC" });

    expect(adapter.modelName).toBe("claude-opus-4-7");
    expect(adapter.providerType).toBe("ANTHROPIC");
  });
});
