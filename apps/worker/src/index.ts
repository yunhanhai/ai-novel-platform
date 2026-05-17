import { prisma, claimNextJob, updateJobStatus } from "@ai-novel/db";
import { createPoller, type JobHandler, type UpdateStatusFn } from "./poll";
import { createGenerateChapterHandler } from "./pipeline/generate-chapter-handler";
import { createDeslopHandler } from "./pipeline/deslop-handler";
import { createExtractMemoryHandler } from "./pipeline/extract-memory-handler";
import { resolveModelProfile } from "./models/model-resolver";
import { createAdapter } from "./models/adapter-factory";
import type { GenerationJob } from "./poll";

const ORGANIZATION_ID = process.env.DEFAULT_ORGANIZATION_ID ?? "default";
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "1000");
const LEASE_DURATION_MS = Number(process.env.WORKER_LEASE_DURATION_MS ?? "120000");
const LOCK_KEY = `worker-${process.pid}-${Date.now()}`;
const USE_FAKE_MODEL = process.env.USE_FAKE_MODEL === "true";

function getEncryptionKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex.slice(0, 64), "hex");
}

const updateJobStatusFn: UpdateStatusFn = (params) =>
  updateJobStatus({ ...params, prisma } as Parameters<typeof updateJobStatus>[0]);

const encryptionKey = getEncryptionKey();

async function resolveModel(job: GenerationJob) {
  if (USE_FAKE_MODEL) return null;

  const profile = await resolveModelProfile({
    organizationId: job.organizationId,
    projectId: job.projectId,
    modelProfileId: (job as { modelProfileId?: string | null }).modelProfileId,
    taskType: job.jobType
  }, prisma);

  if (!profile) return null;
  if (!encryptionKey) {
    console.warn("ENCRYPTION_KEY not set, falling back to fake model");
    return null;
  }

  const provider = profile.provider as {
    providerType: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "DEEPSEEK" | "CUSTOM" | "GEMINI";
    authMode: "USER_KEY" | "PLATFORM_KEY";
    baseUrl: string | null;
    encryptedApiKey: string | null;
  };

  try {
    const adapter = await createAdapter(provider, profile.modelName as string, { encryptionKey });
    return { generate: (prompt: string) => adapter.generate(prompt) };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to create adapter: ${msg}, falling back to fake model`);
    return null;
  }
}

const handlers = new Map<string, JobHandler>([
  ["GENERATE_CHAPTER", createGenerateChapterHandler({
    prisma,
    updateJobStatus: updateJobStatusFn,
    resolveModel
  })],
  ["DESLOP", createDeslopHandler({ prisma, updateJobStatus: updateJobStatusFn, resolveModel })],
  ["EXTRACT_MEMORY", createExtractMemoryHandler({ prisma, updateJobStatus: updateJobStatusFn, resolveModel })]
]);

const poller = createPoller({
  claimNext: () =>
    claimNextJob({
      organizationId: ORGANIZATION_ID,
      lockKey: LOCK_KEY,
      leaseDurationMs: LEASE_DURATION_MS,
      prisma
    }) as ReturnType<typeof claimNextJob>,
  updateJobStatus: updateJobStatusFn,
  pollIntervalMs: POLL_INTERVAL_MS,
  handlers
});

async function main() {
  console.log(`Worker started [${LOCK_KEY}]`);
  console.log(`  Organization: ${ORGANIZATION_ID}`);
  console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`  Lease duration: ${LEASE_DURATION_MS}ms`);

  const signal = AbortSignal.any([
    ...["SIGINT", "SIGTERM"].map((s) => {
      const controller = new AbortController();
      process.on(s, () => controller.abort());
      return controller.signal;
    })
  ]);

  await poller.start(signal);
  console.log("Worker stopped");
}

main().catch((error) => {
  console.error("Worker crashed", error);
  process.exit(1);
});
