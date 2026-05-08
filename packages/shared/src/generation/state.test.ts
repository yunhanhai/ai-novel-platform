import { describe, expect, it } from "vitest";
import {
  assertGenerationJobTransition,
  canTransitionGenerationJob,
  transitionGenerationJob
} from "./state";

describe("generation job state machine", () => {
  it("allows queued jobs to start running", () => {
    expect(canTransitionGenerationJob("queued", "running")).toBe(true);
  });

  it("allows queued jobs to be cancelled", () => {
    expect(canTransitionGenerationJob("queued", "cancelled")).toBe(true);
  });

  it("allows running jobs to finish, fail, or be cancelled", () => {
    expect(canTransitionGenerationJob("running", "succeeded")).toBe(true);
    expect(canTransitionGenerationJob("running", "failed")).toBe(true);
    expect(canTransitionGenerationJob("running", "cancelled")).toBe(true);
  });

  it("rejects terminal jobs from moving back to running", () => {
    expect(canTransitionGenerationJob("succeeded", "running")).toBe(false);
    expect(canTransitionGenerationJob("failed", "running")).toBe(false);
    expect(canTransitionGenerationJob("cancelled", "running")).toBe(false);
  });

  it("rejects failed jobs from becoming succeeded without a retry job", () => {
    expect(() => assertGenerationJobTransition("failed", "succeeded")).toThrow(
      "Invalid generation job status transition: failed -> succeeded"
    );
  });

  it("applies a valid transition with timestamps", () => {
    const started = transitionGenerationJob(
      {
        status: "queued",
        progress: 0,
        startedAt: null,
        finishedAt: null
      },
      "running",
      new Date("2026-04-29T10:00:00.000Z")
    );

    expect(started).toEqual({
      status: "running",
      progress: 0,
      startedAt: new Date("2026-04-29T10:00:00.000Z"),
      finishedAt: null
    });
  });

  it("sets progress and finishedAt for terminal statuses", () => {
    const finished = transitionGenerationJob(
      {
        status: "running",
        progress: 25,
        startedAt: new Date("2026-04-29T10:00:00.000Z"),
        finishedAt: null
      },
      "succeeded",
      new Date("2026-04-29T10:05:00.000Z")
    );

    expect(finished).toEqual({
      status: "succeeded",
      progress: 100,
      startedAt: new Date("2026-04-29T10:00:00.000Z"),
      finishedAt: new Date("2026-04-29T10:05:00.000Z")
    });
  });
});
