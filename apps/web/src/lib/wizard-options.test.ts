import { describe, it, expect } from "vitest";
import {
  GENRE_OPTIONS,
  STYLE_OPTIONS,
  PROJECT_TYPE_OPTIONS,
  getMethodologyOptions,
  joinTags,
  splitTags,
  METHODOLOGY_NONE
} from "./wizard-options";

describe("wizard-options", () => {
  describe("GENRE_OPTIONS", () => {
    it("提供至少 10 项题材选项", () => {
      expect(GENRE_OPTIONS.length).toBeGreaterThanOrEqual(10);
    });

    it("每项有 value 和 label", () => {
      for (const opt of GENRE_OPTIONS) {
        expect(opt.value).toBeTruthy();
        expect(opt.label).toBeTruthy();
      }
    });

    it("value 唯一", () => {
      const values = GENRE_OPTIONS.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    });

    it("覆盖常见题材", () => {
      const values = GENRE_OPTIONS.map((o) => o.value);
      expect(values).toContain("fantasy");
      expect(values).toContain("scifi");
      expect(values).toContain("romance");
    });
  });

  describe("STYLE_OPTIONS", () => {
    it("提供至少 6 项风格选项", () => {
      expect(STYLE_OPTIONS.length).toBeGreaterThanOrEqual(6);
    });

    it("value 唯一", () => {
      const values = STYLE_OPTIONS.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe("PROJECT_TYPE_OPTIONS", () => {
    it("仅包含 LONG_NOVEL 与 SHORT_STORY", () => {
      const values = PROJECT_TYPE_OPTIONS.map((o) => o.value).sort();
      expect(values).toEqual(["LONG_NOVEL", "SHORT_STORY"]);
    });

    it("每项有 label 与 description", () => {
      for (const opt of PROJECT_TYPE_OPTIONS) {
        expect(opt.label).toBeTruthy();
        expect(opt.description).toBeTruthy();
      }
    });
  });

  describe("getMethodologyOptions", () => {
    it("首项是「暂不选择」并使用 METHODOLOGY_NONE 标记", () => {
      const options = getMethodologyOptions();
      expect(options[0]?.value).toBe(METHODOLOGY_NONE);
    });

    it("除暂不选择外，包含 shared 包里的全部方法论模板", () => {
      const options = getMethodologyOptions();
      const values = options.map((o) => o.value);
      expect(values).toContain("snowflake");
      expect(values).toContain("three_act");
      expect(values).toContain("four_act");
      expect(values).toContain("webnovel_speed");
      expect(values).toContain("romance_rhythm");
      expect(values).toContain("short_reversal");
      expect(values).toContain("custom");
    });

    it("每个非「暂不选择」选项的 description 不为空", () => {
      const options = getMethodologyOptions();
      for (const opt of options) {
        if (opt.value === METHODOLOGY_NONE) continue;
        expect(opt.description.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("joinTags / splitTags", () => {
    it("splitTags 处理 null / undefined / 空串", () => {
      expect(splitTags(null)).toEqual([]);
      expect(splitTags(undefined)).toEqual([]);
      expect(splitTags("")).toEqual([]);
      expect(splitTags("   ")).toEqual([]);
    });

    it("splitTags 修剪空白并过滤空段", () => {
      expect(splitTags(" 奇幻 , 玄幻 ,  ,武侠 ")).toEqual(["奇幻", "玄幻", "武侠"]);
    });

    it("joinTags 用英文逗号拼接", () => {
      expect(joinTags(["奇幻", "玄幻"])).toBe("奇幻,玄幻");
    });

    it("joinTags 过滤空与重复", () => {
      expect(joinTags(["奇幻", "", "奇幻", "玄幻"])).toBe("奇幻,玄幻");
    });

    it("joinTags 空数组返回空串", () => {
      expect(joinTags([])).toBe("");
    });

    it("互逆：split(join(x)) === dedupe(x)", () => {
      const input = ["奇幻", "玄幻", "武侠"];
      expect(splitTags(joinTags(input))).toEqual(input);
    });
  });
});
