import { describe, expect, it } from "vitest";
import { computeWordCount } from "./word-count";

describe("computeWordCount", () => {
  it("counts unicode code points after stripping whitespace", () => {
    expect(computeWordCount("Hello 世界  ")).toBe(7);
    expect(computeWordCount("一  二\n三")).toBe(3);
    expect(computeWordCount("")).toBe(0);
  });

  it("ignores all whitespace variants", () => {
    expect(computeWordCount("a\tb\nc d\r\ne")).toBe(5);
  });

  it("handles surrogate-pair emoji as a single code point", () => {
    expect(computeWordCount("ab😀")).toBe(3);
  });
});
