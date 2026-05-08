import { describe, expect, it } from "vitest";
import { activateByKeywords, type KeywordSource } from "./keyword-activation";

const sources: KeywordSource[] = [
  {
    id: "w1",
    sourceType: "world_item",
    name: "青云山",
    content: "青云山是修仙界第一仙山",
    activationKeywords: ["青云", "仙山", "青云山"],
    priority: 10
  },
  {
    id: "w2",
    sourceType: "world_item",
    name: "黑风洞",
    content: "黑风洞藏有远古妖兽",
    activationKeywords: ["黑风", "妖兽", "黑风洞"],
    priority: 5
  },
  {
    id: "ch1",
    sourceType: "character",
    name: "林墨",
    content: "林墨：主角，筑基期修士",
    activationKeywords: ["林墨"],
    priority: 8
  }
];

describe("keyword-activation", () => {
  it("activates sources whose keywords appear in trigger text", () => {
    const trigger = "林墨来到青云山脚下";

    const result = activateByKeywords({ sources, triggerText: trigger });

    expect(result.activated).toHaveLength(2);
    expect(result.activated[0]!.name).toBe("青云山");
    expect(result.activated[1]!.name).toBe("林墨");
  });

  it("returns empty when no keywords match", () => {
    const trigger = "今天天气很好";

    const result = activateByKeywords({ sources, triggerText: trigger });

    expect(result.activated).toHaveLength(0);
  });

  it("sorts by priority descending", () => {
    const trigger = "林墨去了青云山黑风洞探险";

    const result = activateByKeywords({ sources, triggerText: trigger });

    expect(result.activated).toHaveLength(3);
    expect(result.activated[0]!.priority).toBe(10);
    expect(result.activated[1]!.priority).toBe(8);
    expect(result.activated[2]!.priority).toBe(5);
  });
});
