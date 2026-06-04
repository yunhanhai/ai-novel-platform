import { prisma, claimNextJob, updateJobStatus } from "@ai-novel/db";
import { createPoller, type JobHandler, type UpdateStatusFn } from "./poll";
import { createGenerateChapterHandler } from "./pipeline/generate-chapter-handler";
import { createDeslopHandler } from "./pipeline/deslop-handler";
import { createExtractMemoryHandler } from "./pipeline/extract-memory-handler";
import { createFakeModel } from "./pipeline/fake-model";
import { createJobModelResolver } from "./model-runtime";

const ORGANIZATION_ID = process.env.DEFAULT_ORGANIZATION_ID ?? "default";
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "1000");
const LEASE_DURATION_MS = Number(process.env.WORKER_LEASE_DURATION_MS ?? "120000");
const LOCK_KEY = `worker-${process.pid}-${Date.now()}`;
const USE_FAKE_MODEL = process.env.USE_FAKE_MODEL === "true";

const updateJobStatusFn: UpdateStatusFn = (params) =>
  updateJobStatus({ ...params, prisma } as Parameters<typeof updateJobStatus>[0]);

const resolveModel = createJobModelResolver({ prisma, useFakeModel: USE_FAKE_MODEL });

const handlers = new Map<string, JobHandler>([
  ["GENERATE_CHAPTER", createGenerateChapterHandler({
    prisma,
    updateJobStatus: updateJobStatusFn,
    resolveModel,
    ...(USE_FAKE_MODEL ? { model: createFakeModel() } : {})
  })],
  ["DESLOP", createDeslopHandler({
    prisma,
    updateJobStatus: updateJobStatusFn,
    resolveModel,
    ...(USE_FAKE_MODEL ? { model: createFakeModel() } : {})
  })],
  ["EXTRACT_MEMORY", createExtractMemoryHandler({
    prisma,
    updateJobStatus: updateJobStatusFn,
    resolveModel,
    ...(USE_FAKE_MODEL ? { model: createFakeModel() } : {})
  })]
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
