import { describe, expect, it } from "vitest";
import { buildGenerationRequestBody } from "./job-request";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";

const ctx = { budgetPreset: "rich" } as unknown as ContextOptions;

describe("buildGenerationRequestBody", () => {
  it("sends the selected qualityMode for chapter generation", () => {
    const body = buildGenerationRequestBody({ chapterId: "c1", jobType: "GENERATE_CHAPTER", qualityMode: "deep" });
    expect(body).toMatchObject({ chapterId: "c1", jobType: "GENERATE_CHAPTER", qualityMode: "deep" });
  });

  it("builds a DIAGNOSE_CHAPTER request carrying qualityMode but no contextOptions", () => {
    const body = buildGenerationRequestBody({
      chapterId: "c1",
      jobType: "DIAGNOSE_CHAPTER",
      qualityMode: "balanced",
      contextOptions: ctx
    });
    expect(body).toMatchObject({ chapterId: "c1", jobType: "DIAGNOSE_CHAPTER", qualityMode: "balanced" });
    expect(body.contextOptions).toBeUndefined();
  });

  it("only attaches contextOptions for GENERATE_CHAPTER", () => {
    expect(buildGenerationRequestBody({ chapterId: "c1", jobType: "GENERATE_CHAPTER", contextOptions: ctx }).contextOptions).toEqual(ctx);
    expect(buildGenerationRequestBody({ chapterId: "c1", jobType: "DESLOP", contextOptions: ctx }).contextOptions).toBeUndefined();
  });

  it("omits qualityMode when not provided", () => {
    const body = buildGenerationRequestBody({ chapterId: "c1", jobType: "GENERATE_CHAPTER" });
    expect(body.qualityMode).toBeUndefined();
  });
});
