import { prisma, claimNextJob, requeueJobForRetry, updateJobStatus } from "@ai-novel/db";
import { createPoller, type RequeueForRetryFn, type UpdateStatusFn } from "./poll";
import { createHandlers } from "./handlers";
import { createJobModelResolver } from "./model-runtime";
import { createHeartbeat } from "./heartbeat";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "1000");
const LEASE_DURATION_MS = Number(process.env.WORKER_LEASE_DURATION_MS ?? "120000");
const LOCK_KEY = `worker-${process.pid}-${Date.now()}`;
const USE_FAKE_MODEL = process.env.USE_FAKE_MODEL === "true";
const ORGANIZATION_ID = process.env.DEFAULT_ORGANIZATION_ID;

const updateJobStatusFn: UpdateStatusFn = (params) =>
  updateJobStatus({ ...params, prisma } as Parameters<typeof updateJobStatus>[0]);

const requeueForRetryFn: RequeueForRetryFn = (params) => requeueJobForRetry({ ...params, prisma });

const resolveModel = createJobModelResolver({ prisma, useFakeModel: USE_FAKE_MODEL });

const handlers = createHandlers({
  prisma,
  updateJobStatus: updateJobStatusFn,
  resolveModel,
  useFakeModel: USE_FAKE_MODEL
});

const heartbeat = createHeartbeat({
  prisma,
  lockKey: LOCK_KEY,
  organizationId: ORGANIZATION_ID,
  pollIntervalMs: POLL_INTERVAL_MS,
  leaseDurationMs: LEASE_DURATION_MS
});

const poller = createPoller({
  claimNext: () =>
    claimNextJob({
      lockKey: LOCK_KEY,
      leaseDurationMs: LEASE_DURATION_MS,
      prisma
    }) as ReturnType<typeof claimNextJob>,
  updateJobStatus: updateJobStatusFn,
  requeueForRetry: requeueForRetryFn,
  pollIntervalMs: POLL_INTERVAL_MS,
  handlers
});

async function main() {
  console.log(`Worker started [${LOCK_KEY}]`);
  console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`  Lease duration: ${LEASE_DURATION_MS}ms`);
  console.log(`  Heartbeat: ${heartbeat.enabled ? "on" : "off"}`);

  await heartbeat.register();

  const signal = AbortSignal.any([
    ...["SIGINT", "SIGTERM"].map((s) => {
      const controller = new AbortController();
      process.on(s, () => controller.abort());
      return controller.signal;
    })
  ]);

  try {
    await poller.start(signal, (result) => heartbeat.beat(result));
  } finally {
    await heartbeat.unregister().catch(() => undefined);
  }
  console.log("Worker stopped");
}

main().catch((error) => {
  console.error("Worker crashed", error);
  process.exit(1);
});
