import Anthropic from "@anthropic-ai/sdk";
import type { ModelAdapter, ModelResult, ModelGenerateOptions } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicAdapterConfig {
  apiKey: string;
  modelName: string;
  providerType: string;
}

export function createAnthropicAdapter(config: AnthropicAdapterConfig): ModelAdapter {
  const client = new Anthropic({ apiKey: config.apiKey });

  async function generate(prompt: string, options?: ModelGenerateOptions): Promise<ModelResult> {
    const response = await client.messages.create({
      model: config.modelName,
      max_tokens: options?.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.topP !== undefined ? { top_p: options.topP } : {})
    });

    const text = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens
    };
  }

  return {
    generate,
    modelName: config.modelName,
    providerType: config.providerType
  };
}
