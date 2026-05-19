import { describe, it, expect } from "vitest";
import { toggleSingle, toggleMulti } from "./option-toggle";

describe("option-toggle", () => {
  describe("toggleSingle", () => {
    it("当前未选时选中 target", () => {
      expect(toggleSingle(null, "a")).toBe("a");
    });

    it("当前选了别的时切换到 target", () => {
      expect(toggleSingle("a", "b")).toBe("b");
    });

    it("当前已选 target 时取消（返回 null）", () => {
      expect(toggleSingle("a", "a")).toBeNull();
    });
  });

  describe("toggleMulti", () => {
    it("空数组添加 target", () => {
      expect(toggleMulti([], "a")).toEqual(["a"]);
    });

    it("已有 target 时移除", () => {
      expect(toggleMulti(["a", "b"], "a")).toEqual(["b"]);
    });

    it("没有 target 时追加", () => {
      expect(toggleMulti(["a"], "b")).toEqual(["a", "b"]);
    });

    it("不修改原数组（immutable）", () => {
      const input = ["a", "b"];
      toggleMulti(input, "a");
      expect(input).toEqual(["a", "b"]);
    });

    it("保持插入顺序", () => {
      let v: string[] = [];
      v = toggleMulti(v, "c");
      v = toggleMulti(v, "a");
      v = toggleMulti(v, "b");
      expect(v).toEqual(["c", "a", "b"]);
    });
  });
});
