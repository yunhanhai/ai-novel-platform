import { describe, expect, it } from "vitest";
import {
  getMethodologyTemplate,
  listMethodologyTemplates,
  generateOutlineSkeleton,
  renderMethodologyGuide
} from "./methodology-templates";

describe("methodology-templates", () => {
  describe("listMethodologyTemplates", () => {
    it("returns all 6 built-in templates", () => {
      const list = listMethodologyTemplates();
      const types = list.map((t) => t.methodType);

      expect(types).toContain("snowflake");
      expect(types).toContain("three_act");
      expect(types).toContain("four_act");
      expect(types).toContain("webnovel_speed");
      expect(types).toContain("romance_rhythm");
      expect(types).toContain("short_reversal");
    });

    it("each template has outline metadata and review criteria", () => {
      const list = listMethodologyTemplates();
      for (const t of list) {
        expect(t.outlineMetadata.nodes.length).toBeGreaterThan(0);
        expect(t.reviewCriteria.structureChecks.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getMethodologyTemplate", () => {
    it("returns three-act template", () => {
      const t = getMethodologyTemplate("three_act");
      expect(t.name).toBe("三幕式");
      expect(t.outlineMetadata.nodes.length).toBeGreaterThan(0);
    });

    it("throws for custom (no preset)", () => {
      expect(() => getMethodologyTemplate("custom")).toThrow(/未知方法论/);
    });
  });

  describe("generateOutlineSkeleton", () => {
    it("generates snowflake skeleton with progressive structure", () => {
      const nodes = generateOutlineSkeleton("snowflake");
      expect(nodes.length).toBeGreaterThan(3);
      expect(nodes[0]!.title).toContain("一句话");
    });

    it("generates webnovel speed skeleton with chapter-level beats", () => {
      const nodes = generateOutlineSkeleton("webnovel_speed");
      expect(nodes.every((n) => n.level === "chapter")).toBe(true);
    });

    it("returns empty for unknown method type", () => {
      const nodes = generateOutlineSkeleton("custom");
      expect(nodes).toEqual([]);
    });

    it("orderIndex is monotonically increasing", () => {
      const nodes = generateOutlineSkeleton("three_act");
      for (let i = 1; i < nodes.length; i++) {
        expect(nodes[i]!.orderIndex).toBeGreaterThan(nodes[i - 1]!.orderIndex);
      }
    });
  });

  describe("renderMethodologyGuide", () => {
    it("renders a short prompt fragment with all sections", () => {
      const tmpl = getMethodologyTemplate("three_act");
      const text = renderMethodologyGuide(tmpl);

      expect(text).toContain("三幕式");
      expect(text).toContain("结构提示");
      expect(text).toContain("审查重点");
      expect(text.length).toBeLessThanOrEqual(400);
    });

    it("handles minimal methodology (only name)", () => {
      const text = renderMethodologyGuide({ name: "自定义法" });
      expect(text).toContain("自定义法");
    });

    it("truncates oversized text to 400 chars", () => {
      const long = "极长描述".repeat(200);
      const text = renderMethodologyGuide({
        name: "测试",
        description: long
      });
      expect(text.length).toBeLessThanOrEqual(400);
      expect(text.endsWith("...")).toBe(true);
    });

    it("handles malformed metadata without throwing", () => {
      const text = renderMethodologyGuide({
        name: "怪异",
        outlineMetadata: "not-an-object" as unknown,
        reviewCriteria: 42 as unknown
      });
      expect(text).toContain("怪异");
    });
  });
});
