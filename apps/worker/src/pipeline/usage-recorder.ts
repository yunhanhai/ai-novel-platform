import type { PrismaClient } from "@ai-novel/db";
import type { GenerationJob } from "../poll";

export interface ModelUsageMetadata {
  providerId?: string | null;
  modelName: string;
  billingSource: "USER_KEY" | "PLATFORM";
}

export function readModelUsage(model: unknown): ModelUsageMetadata | null {
  if (!model || typeof model !== "object" || !("usage" in model)) return null;
  const usage = (model as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  if (typeof record.modelName !== "string") return null;
  if (record.billingSource !== "USER_KEY" && record.billingSource !== "PLATFORM") return null;
  return {
    modelName: record.modelName,
    billingSource: record.billingSource,
    ...(typeof record.providerId === "string" ? { providerId: record.providerId } : {})
  };
}

export async function recordModelUsage(params: {
  prisma: PrismaClient;
  job: GenerationJob;
  usage?: ModelUsageMetadata | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): Promise<void> {
  const usage = params.usage;
  if (!usage) return;

  try {
    await params.prisma.usageEvent.create({
      data: {
        organizationId: params.job.organizationId,
        userId: params.job.userId,
        projectId: params.job.projectId,
        generationJobId: params.job.id,
        ...(usage.providerId ? { providerId: usage.providerId } : {}),
        modelName: usage.modelName,
        billingSource: usage.billingSource,
        inputTokens: Math.max(0, Math.trunc(params.inputTokens)),
        outputTokens: Math.max(0, Math.trunc(params.outputTokens)),
        latencyMs: Math.max(0, Math.trunc(params.latencyMs))
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to record model usage for job ${params.job.id}: ${message}`);
  }
}
