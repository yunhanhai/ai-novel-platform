import { describe, expect, it } from "vitest";
import { buildContextPacket, type PacketInput } from "./build-context-packet";

const baseInput: PacketInput = {
  projectId: "p1",
  projectTitle: "星辰坠落",
  styleBrief: "科幻史诗风格，冷峻克制",
  currentChapter: {
    id: "c5",
    chapterNo: 5,
    title: "星门开启",
    outlineSummary: "主角团队首次激活远古星门"
  },
  characters: [
    {
      id: "ch1", name: "陈锋", roleType: "protagonist",
      personality: "冷静果断", speechPattern: "简洁利落",
      content: "陈锋：主角，前联邦舰队舰长"
    },
    {
      id: "ch2", name: "林薇", roleType: "supporting",
      personality: "聪慧敏感", speechPattern: "温和有条理",
      content: "林薇：科学院首席研究员"
    }
  ],
  worldItems: [
    {
      id: "w1", name: "星门", itemType: "artifact",
      content: "星门：远古文明留下的跨星系传送装置",
      activationKeywords: ["星门", "传送"]
    }
  ],
  plotThreads: [
    {
      id: "pt1", threadType: "foreshadowing", title: "星门起源之谜",
      content: "伏笔：星门的建造者身份至今不明", status: "progressing"
    }
  ],
  recentMemories: [
    {
      id: "memory-c4",
      memoryType: "chapter_summary",
      content: "第四章：陈锋在遗迹中发现星门坐标",
      scopeType: "chapter",
      sourceChapterId: "c4"
    }
  ],
  tokenBudget: 4000
};

describe("build-context-packet", () => {
  it("includes project meta", () => {
    const { prompt } = buildContextPacket(baseInput);

    expect(prompt).toContain("星辰坠落");
    expect(prompt).toContain("科幻史诗风格");
  });

  it("includes current chapter outline", () => {
    const { prompt } = buildContextPacket(baseInput);

    expect(prompt).toContain("星门开启");
    expect(prompt).toContain("第5章");
  });

  it("includes character cards", () => {
    const { prompt } = buildContextPacket(baseInput);

    expect(prompt).toContain("陈锋");
    expect(prompt).toContain("林薇");
  });

  it("prioritizes characters over world items when budget tight", () => {
    const tight = { ...baseInput, tokenBudget: 100 };
    const { prompt } = buildContextPacket(tight);

    expect(prompt).toContain("陈锋");
  });

  it("produces an activation report", () => {
    const { activationReport } = buildContextPacket(baseInput);

    expect(activationReport.activated.length).toBeGreaterThan(0);
  });

  it("includes plot threads", () => {
    const { prompt } = buildContextPacket(baseInput);

    expect(prompt).toContain("星门起源之谜");
  });

  it("includes recent memories", () => {
    const { prompt } = buildContextPacket(baseInput);

    expect(prompt).toContain("星门坐标");
  });

  it("injects style guide brief and sentence target", () => {
    const { prompt, styleGuide } = buildContextPacket({
      ...baseInput,
      styleGuide: {
        brief: "短句多动词，少用形容词",
        sentenceTarget: { avg: 12, min: 6, max: 24 }
      }
    });

    expect(prompt).toContain("短句多动词");
    expect(prompt).toContain("句长目标");
    expect(styleGuide?.brief).toBe("短句多动词，少用形容词");
  });

  it("injects banned and preferred words at high priority", () => {
    const { prompt } = buildContextPacket({
      ...baseInput,
      styleGuide: {
        banned: ["仿佛", "似乎"],
        preferred: ["剑光", "杀意"]
      }
    });

    expect(prompt).toContain("禁用词");
    expect(prompt).toContain("仿佛");
    expect(prompt).toContain("偏好词");
    expect(prompt).toContain("剑光");
  });

  it("injects methodology guide and review criteria", () => {
    const { prompt, methodologyGuide } = buildContextPacket({
      ...baseInput,
      methodologyGuide: {
        name: "三幕式",
        methodType: "three_act",
        guideText: "建立 → 对抗 → 解决",
        reviewCriteria: ["激励事件是否清晰", "高潮是否回应主线"]
      }
    });

    expect(prompt).toContain("三幕式");
    expect(prompt).toContain("建立 → 对抗");
    expect(prompt).toContain("方法论审查标准");
    expect(prompt).toContain("激励事件");
    expect(methodologyGuide?.methodType).toBe("three_act");
  });

  it("retains banned words even under tight budget", () => {
    const { prompt } = buildContextPacket({
      ...baseInput,
      tokenBudget: 200,
      styleGuide: { banned: ["仿佛"] }
    });

    expect(prompt).toContain("仿佛");
  });
  it("reports included and trimmed assets", () => {
    const result = buildContextPacket({
      ...baseInput,
      recentMemories: [
        ...baseInput.recentMemories,
        {
          id: "memory-c3",
          memoryType: "chapter_summary",
          content: "long memory ".repeat(80),
          scopeType: "chapter",
          sourceChapterId: "c3"
        }
      ],
      tokenBudget: 200
    });

    expect(result.assets.included.length).toBeGreaterThan(0);
    expect(result.assets.trimmed.length).toBeGreaterThan(0);
  });

  it("excludes optional assets by id", () => {
    const result = buildContextPacket({
      ...baseInput,
      contextOptions: { budgetPreset: "standard", excludedAssetIds: ["ch2"], forcedAssetIds: [] }
    });

    expect(result.prompt).not.toContain(baseInput.characters[1]!.name);
    expect(result.assets.excluded.map((a) => a.id)).toContain("ch2");
  });

  it("forces available assets into context", () => {
    const result = buildContextPacket({
      ...baseInput,
      currentChapter: { ...baseInput.currentChapter, title: "solo", outlineSummary: "solo" },
      recentMemories: [],
      contextOptions: { budgetPreset: "standard", excludedAssetIds: [], forcedAssetIds: ["w1"] }
    });

    expect(result.prompt).toContain(baseInput.worldItems[0]!.name);
    expect(result.assets.forced.map((a) => a.id)).toContain("w1");
  });
});

it("budgets mixed CJK and Latin required sections in tokens rather than raw characters", () => {
  const result = buildContextPacket({
    ...baseInput, projectTitle: "Long title ".repeat(80), styleBrief: undefined,
    currentChapter: { id: "chapter", chapterNo: 1, title: "Start" },
    characters: [{ id: "hero", name: "Hero", roleType: "lead", content: "x".repeat(600) }],
    worldItems: [], plotThreads: [], recentMemories: [], tokenBudget: 500
  });
  expect(result.assets.included.map(item => item.id)).toContain("hero");
});


describe("stable memory choices", () => {
  const a = { id: "memory-a", memoryType: "chapter_summary", content: "已排除的旧线索A", scopeType: "chapter", sourceChapterId: "c2" };
  const b = { id: "memory-b", memoryType: "chapter_summary", content: "保留的线索B", scopeType: "chapter", sourceChapterId: "c3" };
  function packet(recentMemories: typeof a[], excludedAssetIds = ["memory:memory-a"]) {
    return buildContextPacket({ ...baseInput, recentMemories, contextOptions: { budgetPreset: "standard", excludedAssetIds, forcedAssetIds: [] } });
  }
  it("keeps a memory excluded when another memory is inserted ahead of it", () => {
    const before = packet([a, b]);
    const after = packet([{ ...b, id: "memory-new", content: "新插入线索" }, a, b]);
    for (const result of [before, after]) {
      expect(result.prompt).not.toContain(a.content);
      expect(result.prompt).toContain(b.content);
      expect(result.assets.excluded.map(item => item.id)).toEqual(["memory:memory-a"]);
    }
  });
  it("does not transfer an exclusion to another memory after deletion or reorder", () => {
    expect(packet([b, a]).prompt).not.toContain(a.content);
    const result = packet([b]);
    expect(result.prompt).toContain(b.content);
    expect(result.assets.excluded).toEqual([]);
  });
  it("separates identical content with different identities and ignores obsolete positional ids", () => {
    const result = packet([a, { ...a, id: "memory-other", sourceChapterId: "c1" }]);
    expect(result.assets.included.filter(item => item.sourceType === "memory").map(item => item.id)).toEqual(["memory:memory-other"]);
    expect(packet([a], ["mem-0"]).prompt).toContain(a.content);
  });
});


describe("exclusions before keyword activation", () => {
  function fixture(excludedAssetIds: string[], forcedAssetIds: string[] = [], outlineSummary = "仅核对案卷") {
    return buildContextPacket({
      ...baseInput, currentChapter: { id: "current", chapterNo: 5, title: "调查", outlineSummary },
      characters: [], plotThreads: [],
      worldItems: [{ id: "secret-world", name: "暗井", itemType: "location", content: "仅由记忆触发的隐藏背景", activationKeywords: ["暗井"] }],
      recentMemories: [{ id: "trigger-memory", memoryType: "world_fact", content: "在暗井调查", scopeType: "project" }],
      contextOptions: { budgetPreset: "standard", excludedAssetIds, forcedAssetIds }
    });
  }
  it("does not activate world context from an excluded memory", () => {
    expect(fixture([]).prompt).toContain("隐藏背景");
    const result = fixture(["memory:trigger-memory"]);
    expect(result.prompt).not.toContain("隐藏背景");
    expect(result.activationReport.triggeredBy).not.toContain("暗井");
    expect(result.activationReport.activated).toEqual([]);
    expect(result.assets.available.map(item => item.id)).toContain("secret-world");
  });
  it("preserves independent activation from the current chapter outline", () => {
    const result = fixture(["memory:trigger-memory"], [], "进入暗井");
    expect(result.prompt).toContain("隐藏背景");
    expect(result.activationReport.activated.map(item => item.id)).toContain("secret-world");
  });
  it("does not report an explicitly excluded world asset as activated", () => {
    const result = fixture(["secret-world"]);
    expect(result.activationReport.activated.map(item => item.id)).not.toContain("secret-world");
    expect(result.assets.excluded.map(item => item.id)).toContain("secret-world");
  });
  it("keeps inactive excluded assets restorable", () => {
    const result = buildContextPacket({ ...baseInput, characters: [], plotThreads: [], recentMemories: [],
      worldItems: [{ id: "secret-world", name: "暗井", itemType: "location", content: "隐藏背景", activationKeywords: ["暗井"] }],
      contextOptions: { budgetPreset: "standard", excludedAssetIds: ["secret-world"], forcedAssetIds: [] }
    });
    expect(result.assets.excluded.map(item => item.id)).toEqual(["secret-world"]);
    expect(result.assets.available.map(item => item.id)).not.toContain("secret-world");
    expect(result.prompt).not.toContain("隐藏背景");
  });
  it("lets exclusion win over force without counting the asset as forced", () => {
    const result = buildContextPacket({ ...baseInput, characters: [], plotThreads: [], recentMemories: [],
      worldItems: [{ id: "secret-world", name: "暗井", itemType: "location", content: "隐藏背景", activationKeywords: ["暗井"] }],
      contextOptions: { budgetPreset: "standard", excludedAssetIds: ["secret-world"], forcedAssetIds: ["secret-world"] }
    });
    expect(result.assets.forced).toEqual([]);
    expect(result.assets.excluded.map(item => item.id)).toContain("secret-world");
    expect(result.prompt).not.toContain("隐藏背景");
  });
});

it("does not list an excluded character in the keyword activation report", () => {
  const result = buildContextPacket({ ...baseInput, currentChapter: { ...baseInput.currentChapter, outlineSummary: "陈锋调查" },
    contextOptions: { budgetPreset: "standard", excludedAssetIds: ["ch1"], forcedAssetIds: [] }
  });
  expect(result.activationReport.activated.map(item => item.id)).not.toContain("ch1");
  expect(result.assets.excluded.map(item => item.id)).toContain("ch1");
});
