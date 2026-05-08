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
});
