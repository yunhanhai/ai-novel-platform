import { describe, expect, it, vi } from "vitest";
import { createHandlers } from "./handlers";

describe("createHandlers", () => {
  function build(useFakeModel: boolean) {
    return createHandlers({
      prisma: {} as never,
      updateJobStatus: vi.fn().mockResolvedValue({}),
      resolveModel: vi.fn(async () => null),
      useFakeModel
    });
  }

  it("registers a handler for every supported job type", () => {
    const handlers = build(true);
    const expected = [
      "GENERATE_OUTLINE",
      "GENERATE_CHAPTER",
      "CONTINUE_CHAPTER",
      "BATCH_CONTINUE",
      "DESLOP",
      "EXTRACT_MEMORY",
      "REWRITE",
      "POLISH",
      "REVIEW",
      "DIAGNOSE_CHAPTER",
      "READER_SIMULATION",
      "STYLE_DRIFT_CHECK",
      "CONTINUITY_CHECK"
    ];

    for (const jobType of expected) {
      expect(handlers.get(jobType), `missing handler for ${jobType}`).toBeTypeOf("function");
    }
    expect(handlers.size).toBe(expected.length);
  });

  it("registers all four diagnostic job types", () => {
    const handlers = build(false);
    for (const jobType of ["DIAGNOSE_CHAPTER", "READER_SIMULATION", "STYLE_DRIFT_CHECK", "CONTINUITY_CHECK"]) {
      expect(handlers.get(jobType)).toBeTypeOf("function");
    }
  });
});
