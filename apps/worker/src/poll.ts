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
  attemptCount?: number;
  maxAttempts?: number;
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
export type RequeueForRetryFn = (params: {
  jobId: string;
  attemptCount: number;
  nextRunAt: Date;
  errorMessage: string;
}) => Promise<unknown>;

const RETRY_BASE_DELAY_MS = 15_000;
const RETRY_MAX_DELAY_MS = 10 * 60_000;

function backoffDelayMs(attemptCount: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1), RETRY_MAX_DELAY_MS);
}

interface PollerDeps {
  claimNext: ClaimFn;
  updateJobStatus: UpdateStatusFn;
  requeueForRetry: RequeueForRetryFn;
  pollIntervalMs: number;
  handlers: Map<string, JobHandler>;
}

interface Poller {
  tick: () => Promise<"processed" | "no_job" | "no_handler" | "retried" | "error">;
  start: (signal: AbortSignal) => Promise<void>;
}

export function createPoller(deps: PollerDeps): Poller {
  const { claimNext, updateJobStatus, requeueForRetry, handlers } = deps;

  async function tick(): Promise<"processed" | "no_job" | "no_handler" | "retried" | "error"> {
    const job = await claimNext();
    if (!job) return "no_job";

    const handler = handlers.get(job.jobType);
    if (!handler) {
      await updateJobStatus({
        jobId: job.id,
        status: "FAILED",
        errorCode: "NO_HANDLER",
        errorMessage: `未注册 jobType=${job.jobType} 的 handler`
      });
      return "no_handler";
    }

    try {
      await handler(job);
      return "processed";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const attemptCount = job.attemptCount ?? 1;
      const maxAttempts = job.maxAttempts ?? 3;

      if (attemptCount < maxAttempts) {
        await requeueForRetry({
          jobId: job.id,
          attemptCount,
          nextRunAt: new Date(Date.now() + backoffDelayMs(attemptCount)),
          errorMessage: message
        });
        return "retried";
      }

      await updateJobStatus({
        jobId: job.id,
        status: "FAILED",
        errorCode: "HANDLER_ERROR",
        errorMessage: `${message}（已重试 ${maxAttempts - 1} 次后放弃）`
      });
      return "error";
    }
  }

  async function start(signal: AbortSignal) {
    while (!signal.aborted) {
      await tick();
      await sleep(deps.pollIntervalMs, signal);
    }
  }

  return { tick, start };
}

export { backoffDelayMs };

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  });
}
