export interface GenerationJob {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  jobType: string;
  status: string;
  input: unknown;
  targetEntityType?: "PROJECT" | "OUTLINE" | "CHAPTER" | null;
  targetEntityId?: string | null;
  attemptCount?: number | null;
  maxAttempts?: number | null;
  nextRunAt?: Date | string | null;
}

export type JobHandler = (job: GenerationJob) => Promise<void>;

type ClaimFn = () => Promise<GenerationJob | null>;
export type UpdateStatusFn = (params: {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}) => Promise<unknown>;

type ScheduleJobRetryFn = (params: {
  jobId: string;
  attemptCount: number;
  errorCode: string;
  errorMessage: string;
  now?: Date;
}) => Promise<unknown>;

type MarkJobFailedFn = (params: {
  jobId: string;
  errorCode: string;
  errorMessage: string;
  now?: Date;
}) => Promise<unknown>;

type RecoverExpiredLeasesFn = () => Promise<unknown>;

interface PollerDeps {
  claimNext: ClaimFn;
  updateJobStatus?: UpdateStatusFn;
  scheduleJobRetry: ScheduleJobRetryFn;
  markJobFailed: MarkJobFailedFn;
  recoverExpiredLeases: RecoverExpiredLeasesFn;
  now?: () => Date;
  pollIntervalMs: number;
  handlers: Map<string, JobHandler>;
}

type TickResult = "processed" | "no_job" | "no_handler" | "error";

interface Poller {
  tick: () => Promise<TickResult>;
  start: (signal: AbortSignal, onTick?: (result: TickResult) => void) => Promise<void>;
}

export function createPoller(deps: PollerDeps): Poller {
  const { claimNext, scheduleJobRetry, markJobFailed, recoverExpiredLeases, handlers } = deps;
  const now = deps.now ?? (() => new Date());

  async function tick(): Promise<TickResult> {
    await recoverExpiredLeases();

    const job = await claimNext();
    if (!job) return "no_job";

    const handler = handlers.get(job.jobType);
    if (!handler) {
      await markJobFailed({
        jobId: job.id,
        errorCode: "NO_HANDLER",
        errorMessage: `No handler registered for jobType=${job.jobType}`,
        now: now()
      });
      return "no_handler";
    }

    try {
      await handler(job);
      return "processed";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const attemptCount = job.attemptCount ?? 0;
      const maxAttempts = job.maxAttempts ?? 1;
      const failedAt = now();

      if (attemptCount + 1 >= maxAttempts) {
        await markJobFailed({
          jobId: job.id,
          errorCode: "HANDLER_ERROR",
          errorMessage: message,
          now: failedAt
        });
      } else {
        await scheduleJobRetry({
          jobId: job.id,
          attemptCount,
          errorCode: "HANDLER_ERROR",
          errorMessage: message,
          now: failedAt
        });
      }

      return "error";
    }
  }

  async function start(signal: AbortSignal, onTick?: (result: TickResult) => void) {
    while (!signal.aborted) {
      const result = await tick();
      onTick?.(result);
      await sleep(deps.pollIntervalMs, signal);
    }
  }

  return { tick, start };
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
