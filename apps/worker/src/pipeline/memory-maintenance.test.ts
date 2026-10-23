import { describe, expect, it, vi } from "vitest";
import {
  enforceCharacterStateQuota,
  isDuplicateContent,
  maintainChapterSummary,
  supersedeCharacterState
} from "./memory-maintenance";

function makeTx() {
  return {
    projectMemory: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    }
  };
}

const base = {
  organizationId: "org-1",
  projectId: "p-1",
  chapterId: "ch-1"
};

describe("isDuplicateContent", () => {
  it("matches ignoring surrounding whitespace", () => {
    expect(isDuplicateContent([" 已有记忆 "], "已有记忆")).toBe(true);
    expect(isDuplicateContent(["已有记忆"], "新记忆")).toBe(false);
  });
});

describe("maintainChapterSummary", () => {
  it("supersedes all older summaries for the same chapter", async () => {
    const tx = makeTx();
    await maintainChapterSummary({ tx, ...base });

    expect(tx.projectMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memoryType: "chapter_summary",
          scopeId: "ch-1"
        }),
        data: { status: "superseded" }
      })
    );
  });
});

describe("supersedeCharacterState", () => {
  it("supersedes only that character's earlier states including accepted", async () => {
    const tx = makeTx();
    await supersedeCharacterState({ tx, ...base, characterName: "林墨" });

    expect(tx.projectMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memoryType: "character_state",
          status: { in: ["proposed", "accepted"] },
          content: { startsWith: "林墨: " }
        }),
        data: { status: "superseded" }
      })
    );
  });
});

describe("enforceCharacterStateQuota", () => {
  it("returns nothing when under the quota", async () => {
    const tx = makeTx();
    tx.projectMemory.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    const result = await enforceCharacterStateQuota({ tx, ...base, keep: 5 });
    expect(result).toEqual([]);
  });

  it("returns the oldest ids to evict when over the quota", async () => {
    const tx = makeTx();
    tx.projectMemory.findMany.mockResolvedValue([
      { id: "old-1" },
      { id: "old-2" },
      { id: "new-1" },
      { id: "new-2" },
      { id: "new-3" }
    ]);

    const result = await enforceCharacterStateQuota({ tx, ...base, keep: 3 });
    expect(result).toEqual(["old-1", "old-2"]);
  });
});
