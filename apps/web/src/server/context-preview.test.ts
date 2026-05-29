import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildChapterContextPreview } from "./context-preview";

function createPrismaMock() {
  return {
    chapter: { findFirst: vi.fn() },
    character: { findMany: vi.fn() },
    worldItem: { findMany: vi.fn() },
    plotThread: { findMany: vi.fn() },
    projectMemory: { findMany: vi.fn() },
    styleProfile: { findFirst: vi.fn() },
    writingMethodology: { findFirst: vi.fn() }
  };
}

describe("buildChapterContextPreview", () => {
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
  });

  it("returns null when chapter is missing", async () => {
    prisma.chapter.findFirst.mockResolvedValue(null);

    const preview = await buildChapterContextPreview({
      organizationId: "org-1",
      chapterId: "chapter-missing",
      prisma: prisma as never
    });

    expect(preview).toBeNull();
  });

  it("returns grouped context preview for a chapter", async () => {
    prisma.chapter.findFirst.mockResolvedValue({
      id: "chapter-1",
      projectId: "project-1",
      chapterNo: 3,
      title: "Gate",
      outlineSummary: "Hero opens Gate",
      project: { title: "Starfall", styleBrief: "lean prose" },
      targetOutlines: [{ summary: "Hero opens Gate with old key" }]
    });
    prisma.character.findMany.mockResolvedValue([
      {
        id: "char-1",
        name: "Hero",
        roleType: "protagonist",
        personality: "decisive",
        speechPattern: "short",
        motivation: "survive",
        appearance: null,
        constraints: null,
        arc: null
      }
    ]);
    prisma.worldItem.findMany.mockResolvedValue([
      {
        id: "world-1",
        name: "Gate",
        itemType: "artifact",
        summary: "Ancient transit gate",
        detail: null,
        constraints: "Requires old key",
        activationKeywords: ["Gate"],
        priority: 5
      }
    ]);
    prisma.plotThread.findMany.mockResolvedValue([
      {
        id: "thread-1",
        title: "Gate origin",
        threadType: "mystery",
        description: "Who built it?",
        status: "progressing",
        priority: 8
      }
    ]);
    prisma.projectMemory.findMany.mockResolvedValue([
      {
        memoryType: "chapter_summary",
        content: "Hero found the key.",
        scopeType: "chapter",
        sourceChapterId: "chapter-2"
      }
    ]);
    prisma.styleProfile.findFirst.mockResolvedValue({
      styleBrief: "active style",
      bannedWords: ["suddenly"],
      preferredWords: ["steel"],
      sentenceLengthProfile: { avg: 12, min: 6, max: 22 }
    });
    prisma.writingMethodology.findFirst.mockResolvedValue({
      name: "Three Act",
      methodType: "three_act",
      outlineMetadata: null,
      reviewCriteria: ["keep causal pressure"]
    });

    const preview = await buildChapterContextPreview({
      organizationId: "org-1",
      chapterId: "chapter-1",
      rawOptions: { budgetPreset: "compact", excludedAssetIds: ["char-1"] },
      prisma: prisma as never
    });

    expect(preview).not.toBeNull();
    expect(preview?.budgetPreset).toBe("compact");
    expect(preview?.projectId).toBe("project-1");
    expect(preview?.excluded.map((asset) => asset.id)).toContain("char-1");
    expect(preview?.included.some((asset) => asset.id === "world-1")).toBe(true);
    expect(preview?.available).toEqual(expect.any(Array));
    expect(preview?.promptPreview).toContain("Starfall");
  });
});
