export interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelGenerateOptions {
  reasoningEffort?: "low" | "medium" | "high";
  responseFormat?: "json_object";
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ModelAdapter {
  generate(prompt: string, options?: ModelGenerateOptions): Promise<ModelResult>;
  readonly modelName: string;
  readonly providerType: string;
}
