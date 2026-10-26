import { describe, expect, it } from "vitest";
import { diffText, summarizeDiff, tokenize } from "./text-diff";

describe("tokenize", () => {
  it("splits CJK per character and keeps latin words intact", () => {
    expect(tokenize("你好 world")).toEqual(["你", "好", "world"]);
  });

  it("keeps punctuation as its own token", () => {
    expect(tokenize("好。")).toEqual(["好", "。"]);
  });
});

describe("diffText", () => {
  it("returns a single equal segment for identical text", () => {
    expect(diffText("一样的文字", "一样的文字")).toEqual([{ kind: "equal", text: "一样的文字" }]);
  });

  it("marks pure insertions", () => {
    const segments = diffText("她走了。", "她走了，又回来了。");
    expect(segments.some((s) => s.kind === "insert")).toBe(true);
    expect(segments.every((s) => s.kind !== "delete")).toBe(true);
  });

  it("marks pure deletions", () => {
    const segments = diffText("他推开门，屋里的灰尘扑面而来。", "他推开门。");
    expect(segments.some((s) => s.kind === "delete")).toBe(true);
    expect(segments.every((s) => s.kind !== "insert")).toBe(true);
  });

  it("keeps unchanged context between edits", () => {
    const segments = diffText("开头一样，中间改了，结尾一样。", "开头一样，中间变了，结尾一样。");
    expect(segments[0]!.kind).toBe("equal");
    expect(segments[0]!.text).toContain("开头一样，中间");
    expect(segments[segments.length - 1]!.kind).toBe("equal");
    expect(segments.some((s) => s.kind === "delete")).toBe(true);
    expect(segments.some((s) => s.kind === "insert")).toBe(true);
  });

  it("reconstructs both sides from the segments", () => {
    const before = "第一章的开头，主角登场。";
    const after = "第一章的开头，主角和配角一起登场。";
    const segments = diffText(before, after);

    const rebuiltBefore = segments.filter((s) => s.kind !== "insert").map((s) => s.text).join("");
    const rebuiltAfter = segments.filter((s) => s.kind !== "delete").map((s) => s.text).join("");

    expect(rebuiltBefore).toBe(before);
    expect(rebuiltAfter).toBe(after);
  });

  it("falls back to a coarse replacement for very long inputs", () => {
    const before = "甲".repeat(4500);
    const after = "乙".repeat(4500);
    const segments = diffText(before, after);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.kind).toBe("delete");
    expect(segments[1]!.kind).toBe("insert");
  });
});

describe("summarizeDiff", () => {
  it("counts added and removed characters", () => {
    const summary = summarizeDiff([
      { kind: "equal", text: "共同" },
      { kind: "insert", text: "新增" },
      { kind: "delete", text: "删" }
    ]);
    expect(summary).toEqual({ addedChars: 2, removedChars: 1, changed: true });
  });

  it("reports unchanged when only equal segments exist", () => {
    expect(summarizeDiff([{ kind: "equal", text: "同" }])).toEqual({
      addedChars: 0,
      removedChars: 0,
      changed: false
    });
  });
});
