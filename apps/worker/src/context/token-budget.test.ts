import { describe, expect, it } from "vitest";
import { applyTokenBudget } from "./token-budget";

interface BudgetItem {
  id: string;
  content: string;
  priority: number;
}

describe("token-budget", () => {
  it("includes all items when under budget", () => {
    const items: BudgetItem[] = [
      { id: "a", content: "短", priority: 10 },
      { id: "b", content: "短", priority: 5 }
    ];

    const result = applyTokenBudget({ items, tokenBudget: 100 });

    expect(result.included).toHaveLength(2);
    expect(result.trimmed).toHaveLength(0);
  });

  it("trims lowest priority items first", () => {
    const items: BudgetItem[] = [
      { id: "hi", content: "题".repeat(300), priority: 10 },
      { id: "mid", content: "答".repeat(150), priority: 5 },
      { id: "lo", content: "注".repeat(100), priority: 1 }
    ];

    // 中文按 1 字 ≈ 1 token 估算：hi=300, mid=150, lo=100
    const result = applyTokenBudget({ items, tokenBudget: 480 });

    expect(result.included).toHaveLength(2);
    expect(result.included[0]!.id).toBe("hi");
    expect(result.included[1]!.id).toBe("mid");
    expect(result.trimmed).toHaveLength(1);
    expect(result.trimmed[0]!.id).toBe("lo");
  });

  it("trims item over budget and reports usage correctly", () => {
    const items: BudgetItem[] = [
      { id: "a", content: "文".repeat(200), priority: 10 }
    ];

    // 中文 200 字 ≈ 200 tokens > 50 token 预算 → trimmed, usage=0
    const result = applyTokenBudget({ items, tokenBudget: 50 });

    expect(result.estimatedTokens).toBe(0);
    expect(result.trimmed).toHaveLength(1);
    expect(result.included).toHaveLength(0);
  });

  it("estimates english content at roughly four characters per token", () => {
    const items: BudgetItem[] = [
      { id: "en", content: "word".repeat(100), priority: 10 }
    ];

    // 400 个 ASCII 字符 ≈ 100 tokens，正好放进 100 的预算
    const result = applyTokenBudget({ items, tokenBudget: 100 });

    expect(result.included).toHaveLength(1);
    expect(result.estimatedTokens).toBe(100);
  });
});
