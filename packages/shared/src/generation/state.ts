export type GenerationJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface GenerationJobState {
  status: GenerationJobStatus;
  progress: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const allowedTransitions: Record<GenerationJobStatus, readonly GenerationJobStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: []
};

const terminalStatuses = new Set<GenerationJobStatus>(["succeeded", "failed", "cancelled"]);

export function canTransitionGenerationJob(
  from: GenerationJobStatus,
  to: GenerationJobStatus
): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertGenerationJobTransition(
  from: GenerationJobStatus,
  to: GenerationJobStatus
): void {
  if (!canTransitionGenerationJob(from, to)) {
    throw new Error(`Invalid generation job status transition: ${from} -> ${to}`);
  }
}

export function transitionGenerationJob(
  current: GenerationJobState,
  nextStatus: GenerationJobStatus,
  now = new Date()
): GenerationJobState {
  assertGenerationJobTransition(current.status, nextStatus);

  return {
    ...current,
    status: nextStatus,
    progress: nextStatus === "succeeded" ? 100 : current.progress,
    startedAt: nextStatus === "running" ? now : current.startedAt,
    finishedAt: terminalStatuses.has(nextStatus) ? now : current.finishedAt
  };
}
