import { describe, expect, it } from "vitest";
import { estimateTokens } from "./token-estimate";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts CJK characters as roughly one token each", () => {
    expect(estimateTokens("她坐在窗边，头也不抬。")).toBe(11);
    expect(estimateTokens("文".repeat(500))).toBe(500);
  });

  it("counts non-CJK text at roughly four characters per token", () => {
    expect(estimateTokens("word")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("a".repeat(401))).toBe(101);
  });

  it("blends both scripts in mixed content", () => {
    // 4 个汉字 + "test"(4 ASCII → 1 token) = 5
    expect(estimateTokens("她抬起头test".slice(0, 8))).toBe(5);
  });

  it("never underestimates Chinese by more than the safe bound", () => {
    // 中文内容：估算值不应低于字数的一半（旧实现 chars/4 会低估到 1/4）
    const chinese = "这是一段用于校验估算下限的中文内容".repeat(20);
    expect(estimateTokens(chinese)).toBeGreaterThanOrEqual(chinese.length / 2);
  });
});
