export type {
  ModelAdapter,
  ModelResult,
  ModelGenerateOptions
} from "./types";

export {
  createAdapter,
  type ProviderRecord,
  type AdapterFactoryDeps
} from "./adapter-factory";

export {
  createOpenAIAdapter,
  type OpenAIAdapterConfig
} from "./openai-adapter";

export {
  createAnthropicAdapter,
  type AnthropicAdapterConfig
} from "./anthropic-adapter";

export {
  resolveModelProfile,
  type ResolverInput
} from "./model-resolver";
