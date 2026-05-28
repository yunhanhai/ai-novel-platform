export type WorkerTickStatus = "processed" | "no_job" | "no_handler" | "error";

export type UpsertHeartbeatFn = (params: {
  organizationId: string;
  lockKey: string;
  pid?: number | null;
  startedAt: Date;
  lastSeenAt: Date;
  pollIntervalMs: number;
  leaseDurationMs: number;
  lastTickStatus?: string | null;
  lastTickAt?: Date | null;
  metadata?: Record<string, unknown>;
}) => Promise<unknown>;

interface WorkerHeartbeatDeps {
  organizationId: string;
  lockKey: string;
  pid?: number | null;
  startedAt: Date;
  pollIntervalMs: number;
  leaseDurationMs: number;
  heartbeatIntervalMs?: number;
  metadata?: Record<string, unknown>;
  upsert: UpsertHeartbeatFn;
  warn?: (message: string) => void;
}

interface WorkerHeartbeat {
  reportTick: (status: WorkerTickStatus, at?: Date) => void;
  start: (signal: AbortSignal) => Promise<void>;
}

export function createWorkerHeartbeat(deps: WorkerHeartbeatDeps): WorkerHeartbeat {
  let lastTickStatus: WorkerTickStatus | null = null;
  let lastTickAt: Date | null = null;
  const heartbeatIntervalMs = deps.heartbeatIntervalMs ?? 10_000;
  const warn = deps.warn ?? ((message) => console.warn(message));

  function reportTick(status: WorkerTickStatus, at = new Date()) {
    lastTickStatus = status;
    lastTickAt = at;
  }

  async function writeHeartbeat() {
    try {
      await deps.upsert({
        organizationId: deps.organizationId,
        lockKey: deps.lockKey,
        pid: deps.pid,
        startedAt: deps.startedAt,
        lastSeenAt: new Date(),
        pollIntervalMs: deps.pollIntervalMs,
        leaseDurationMs: deps.leaseDurationMs,
        lastTickStatus,
        lastTickAt,
        metadata: deps.metadata
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Worker heartbeat failed: ${message}`);
    }
  }

  async function start(signal: AbortSignal) {
    while (!signal.aborted) {
      await writeHeartbeat();
      await sleep(heartbeatIntervalMs, signal);
    }
  }

  return { reportTick, start };
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
