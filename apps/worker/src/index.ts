import {
  prisma,
  claimNextJob,
  updateJobStatus,
  upsertWorkerHeartbeat,
  scheduleJobRetry,
  markJobFailed,
  recoverExpiredJobLeases
} from "@ai-novel/db";
import { createPoller, type UpdateStatusFn } from "./poll";
import { createWorkerHeartbeat } from "./heartbeat";
import { createHandlers } from "./worker-handlers";
import { resolveModelProfile, createAdapter } from "@ai-novel/model-adapters";
import type { GenerationJob } from "./poll";

const ORGANIZATION_ID = process.env.DEFAULT_ORGANIZATION_ID ?? "default";
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "1000");
const LEASE_DURATION_MS = Number(process.env.WORKER_LEASE_DURATION_MS ?? "120000");
const HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? "10000");
const LOCK_KEY = `worker-${process.pid}-${Date.now()}`;
const STARTED_AT = new Date();
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
    id?: string;
    providerType: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "DEEPSEEK" | "CUSTOM" | "GEMINI";
    authMode: "USER_KEY" | "PLATFORM_KEY";
    baseUrl: string | null;
    encryptedApiKey: string | null;
  };

  try {
    const adapter = await createAdapter(provider, profile.modelName as string, { encryptionKey });
    return {
      usage: {
        providerId: provider.id,
        modelName: adapter.modelName,
        billingSource: provider.authMode === "USER_KEY" ? "USER_KEY" as const : "PLATFORM" as const
      },
      generate: (prompt: string) => adapter.generate(prompt)
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to create adapter: ${msg}, falling back to fake model`);
    return null;
  }
}

const handlers = createHandlers({
  prisma,
  updateJobStatus: updateJobStatusFn,
  resolveModel,
  useFakeModel: USE_FAKE_MODEL
});

const poller = createPoller({
  claimNext: () =>
    claimNextJob({
      organizationId: ORGANIZATION_ID,
      lockKey: LOCK_KEY,
      leaseDurationMs: LEASE_DURATION_MS,
      prisma
    }) as ReturnType<typeof claimNextJob>,
  updateJobStatus: updateJobStatusFn,
  scheduleJobRetry: (params) =>
    scheduleJobRetry({ ...params, prisma } as Parameters<typeof scheduleJobRetry>[0]),
  markJobFailed: (params) =>
    markJobFailed({ ...params, prisma } as Parameters<typeof markJobFailed>[0]),
  recoverExpiredLeases: () =>
    recoverExpiredJobLeases({
      organizationId: ORGANIZATION_ID,
      prisma
    }),
  pollIntervalMs: POLL_INTERVAL_MS,
  handlers
});

const heartbeat = createWorkerHeartbeat({
  organizationId: ORGANIZATION_ID,
  lockKey: LOCK_KEY,
  pid: process.pid,
  startedAt: STARTED_AT,
  pollIntervalMs: POLL_INTERVAL_MS,
  leaseDurationMs: LEASE_DURATION_MS,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  upsert: (params) =>
    upsertWorkerHeartbeat({ ...params, prisma } as Parameters<typeof upsertWorkerHeartbeat>[0])
});

async function main() {
  console.log(`Worker started [${LOCK_KEY}]`);
  console.log(`  Organization: ${ORGANIZATION_ID}`);
  console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`  Lease duration: ${LEASE_DURATION_MS}ms`);
  console.log(`  Heartbeat interval: ${HEARTBEAT_INTERVAL_MS}ms`);

  const signal = AbortSignal.any([
    ...["SIGINT", "SIGTERM"].map((s) => {
      const controller = new AbortController();
      process.on(s, () => controller.abort());
      return controller.signal;
    })
  ]);

  await Promise.all([
    heartbeat.start(signal),
    poller.start(signal, (status) => heartbeat.reportTick(status))
  ]);
  console.log("Worker stopped");
}

main().catch((error) => {
  console.error("Worker crashed", error);
  process.exit(1);
});
