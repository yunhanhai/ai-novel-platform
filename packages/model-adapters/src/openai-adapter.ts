import OpenAI from "openai";
import type { ModelAdapter, ModelResult, ModelGenerateOptions } from "./types";

export interface OpenAIAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  modelName: string;
  providerType: string;
}

export function createOpenAIAdapter(config: OpenAIAdapterConfig): ModelAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {})
  });

  async function generate(prompt: string, options?: ModelGenerateOptions): Promise<ModelResult> {
    const response = await client.chat.completions.create({
      model: config.modelName,
      messages: [{ role: "user", content: prompt }],
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options?.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {})
    });

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0
    };
  }

  return {
    generate,
    modelName: config.modelName,
    providerType: config.providerType
  };
}
