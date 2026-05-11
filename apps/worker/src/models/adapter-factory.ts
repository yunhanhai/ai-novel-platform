import { decrypt } from "@ai-novel/shared/crypto/encryption";
import { createOpenAIAdapter } from "./openai-adapter";
import { createAnthropicAdapter } from "./anthropic-adapter";
import type { ModelAdapter } from "./types";

export interface ProviderRecord {
  providerType: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "CUSTOM";
  authMode: "USER_KEY" | "PLATFORM_KEY";
  baseUrl: string | null;
  encryptedApiKey: string | null;
}

export interface AdapterFactoryDeps {
  encryptionKey: Buffer;
  env?: NodeJS.ProcessEnv;
}

export async function createAdapter(
  provider: ProviderRecord,
  modelName: string,
  deps: AdapterFactoryDeps
): Promise<ModelAdapter> {
  const apiKey = await resolveApiKey(provider, deps);

  switch (provider.providerType) {
    case "ANTHROPIC":
      return createAnthropicAdapter({ apiKey, modelName, providerType: provider.providerType });

    case "OPENAI_COMPATIBLE":
    case "DEEPSEEK":
    case "CUSTOM":
      return createOpenAIAdapter({
        apiKey,
        modelName,
        providerType: provider.providerType,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {})
      });

    case "GEMINI":
      throw new Error("UNSUPPORTED_PROVIDER: GEMINI not implemented in phase 1");

    default:
      throw new Error(`UNSUPPORTED_PROVIDER: ${provider.providerType as string}`);
  }
}

async function resolveApiKey(provider: ProviderRecord, deps: AdapterFactoryDeps): Promise<string> {
  const env = deps.env ?? process.env;

  if (provider.authMode === "USER_KEY") {
    if (!provider.encryptedApiKey) {
      throw new Error("API_KEY_NOT_RESOLVED: USER_KEY mode but encryptedApiKey is null");
    }
    return decrypt(provider.encryptedApiKey, deps.encryptionKey);
  }

  // PLATFORM_KEY
  const envKey = provider.providerType === "ANTHROPIC" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const value = env[envKey];
  if (!value) {
    throw new Error(`API_KEY_NOT_RESOLVED: ${envKey} not set`);
  }
  return value;
}
