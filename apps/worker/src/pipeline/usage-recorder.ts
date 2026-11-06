import type { PrismaClient } from "@ai-novel/db";
import type { GenerationJob } from "../poll";

interface ModelUsageMetadata {
  modelName: string;
  billingSource: "USER_KEY" | "PLATFORM";
  providerId?: string;
}

export function readModelUsage(model: unknown): ModelUsageMetadata | null {
  if (!model || typeof model !== "object") return null;
  const record = model as Record<string, unknown>;
  if (typeof record.modelName !== "string" || !record.modelName.trim()) return null;
  if (record.billingSource !== "USER_KEY" && record.billingSource !== "PLATFORM") return null;
  return {
    modelName: record.modelName,
    billingSource: record.billingSource,
    ...(typeof record.providerId === "string" ? { providerId: record.providerId } : {})
  };
}

// Usage evidence must not turn a completed side operation into a duplicate retry.
// Main chapter generation keeps its existing aggregate event in the finalize transaction.
export async function recordModelUsage(params: {
  prisma: PrismaClient;
  job: GenerationJob;
  model: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): Promise<void> {
  const usage = readModelUsage(params.model);
  if (!usage) return;
  try {
    await params.prisma.usageEvent.create({ data: {
      organizationId: params.job.organizationId,
      projectId: params.job.projectId,
      userId: params.job.userId,
      generationJobId: params.job.id,
      ...usage,
      inputTokens: nonnegativeInt(params.inputTokens),
      outputTokens: nonnegativeInt(params.outputTokens),
      latencyMs: nonnegativeInt(params.latencyMs)
    } });
  } catch {
    console.warn(`[usage] 无法记录任务 ${params.job.id} 的模型用量`);
  }
}

function nonnegativeInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
