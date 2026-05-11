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

interface PollerDeps {
  claimNext: ClaimFn;
  updateJobStatus: UpdateStatusFn;
  pollIntervalMs: number;
  handlers: Map<string, JobHandler>;
}

interface Poller {
  tick: () => Promise<"processed" | "no_job" | "no_handler" | "error">;
  start: (signal: AbortSignal) => Promise<void>;
}

export function createPoller(deps: PollerDeps): Poller {
  const { claimNext, updateJobStatus, handlers } = deps;

  async function tick(): Promise<"processed" | "no_job" | "no_handler" | "error"> {
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
      await updateJobStatus({
        jobId: job.id,
        status: "FAILED",
        errorCode: "HANDLER_ERROR",
        errorMessage: message
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

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  });
}
