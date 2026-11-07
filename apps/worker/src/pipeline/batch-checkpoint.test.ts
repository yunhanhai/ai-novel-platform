import { describe, expect, it } from "vitest";
import { readBatchCheckpoint } from "./batch-checkpoint";
const valid = { mode: "BATCH_CONTINUE", checkpointVersion: 1, chapterId: "chapter", requestedChapters: 2,
  completedChapters: 1, addedChars: 6, memoryExtractedChapters: 0, generationWarnings: [] };
describe("batch checkpoint validation", () => {
  it("accepts only a matching scoped checkpoint and ignores unrelated final-version metadata", () => {
    expect(readBatchCheckpoint({ ...valid, versionId: "version-1" }, "chapter", 2)).toEqual(valid);
    expect(readBatchCheckpoint(null, "chapter", 2)).toBeNull();
  });
  it.each([
    { ...valid, chapterId: "other" }, { ...valid, requestedChapters: 3 },
    { ...valid, completedChapters: 3 }, { ...valid, completedChapters: -1 },
    { ...valid, addedChars: -1 }, { ...valid, memoryExtractedChapters: 2 },
    { ...valid, generationWarnings: [{}] }, { mode: "BATCH_CONTINUE" }
  ])("rejects invalid progress without guessing saved rounds: %j", value => {
    expect(() => readBatchCheckpoint(value, "chapter", 2)).toThrow("批量进度记录无效");
  });
});
