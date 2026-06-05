import { createAdapter, resolveModelProfile, type ProviderRecord, type ModelGenerateOptions } from "@ai-novel/model-adapters";
import type { PrismaClient } from "@ai-novel/db";
import type { GenerationJob } from "./poll";

export type BillingSource = "USER_KEY" | "PLATFORM";

export interface RuntimeModel {
  generate(prompt: string, options?: ModelGenerateOptions): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  modelName: string;
  billingSource: BillingSource;
}

interface Logger {
  warn(message: string): void;
}

interface CreateJobModelResolverParams {
  prisma: PrismaClient;
  useFakeModel: boolean;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}

export function getEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const hex = env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex.slice(0, 64), "hex");
}

export function createJobModelResolver(params: CreateJobModelResolverParams) {
  const env = params.env ?? process.env;
  const logger = params.logger ?? console;
  const encryptionKey = getEncryptionKey(env);

  return async function resolveModel(job: GenerationJob): Promise<RuntimeModel | null> {
    if (params.useFakeModel) return null;

    const profile = await resolveModelProfile({
      organizationId: job.organizationId,
      projectId: job.projectId,
      modelProfileId: (job as { modelProfileId?: string | null }).modelProfileId,
      taskType: job.jobType
    }, params.prisma);

    if (!profile) return null;

    const provider = profile.provider as ProviderRecord | undefined;
    const modelName = profile.modelName as string | undefined;
    if (!provider || !modelName) return null;

    if (provider.authMode === "USER_KEY" && !encryptionKey) {
      logger.warn("ENCRYPTION_KEY not set; USER_KEY model profile cannot be used");
      return null;
    }

    try {
      const adapter = await createAdapter(provider, modelName, { encryptionKey, env });
      return {
        generate: (prompt: string, options?: ModelGenerateOptions) => adapter.generate(prompt, options),
        modelName,
        billingSource: provider.authMode === "USER_KEY" ? "USER_KEY" : "PLATFORM"
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to create model adapter: ${msg}`);
      return null;
    }
  };
}
