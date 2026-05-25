import { describe, expect, it, vi } from "vitest";
import { createHandlers } from "./worker-handlers";

function deps() {
  return {
    prisma: {},
    updateJobStatus: vi.fn().mockResolvedValue({}),
    resolveModel: vi.fn().mockResolvedValue(null),
    useFakeModel: true
  };
}

describe("worker handler registration", () => {
  it("registers chapter generation and diagnostic job handlers", () => {
    const handlers = createHandlers(deps() as never);

    expect(handlers.has("GENERATE_CHAPTER")).toBe(true);
    expect(handlers.has("DESLOP")).toBe(true);
    expect(handlers.has("EXTRACT_MEMORY")).toBe(true);
    expect(handlers.has("DIAGNOSE_CHAPTER")).toBe(true);
    expect(handlers.has("READER_SIMULATION")).toBe(true);
    expect(handlers.has("STYLE_DRIFT_CHECK")).toBe(true);
    expect(handlers.has("CONTINUITY_CHECK")).toBe(true);
  });
});
