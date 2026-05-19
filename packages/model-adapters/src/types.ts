export interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelGenerateOptions {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
}

export interface ModelAdapter {
  generate(prompt: string, options?: ModelGenerateOptions): Promise<ModelResult>;
  readonly modelName: string;
  readonly providerType: string;
}
