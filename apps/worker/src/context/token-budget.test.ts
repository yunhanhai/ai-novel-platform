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
      { id: "hi", content: "X".repeat(600), priority: 10 },
      { id: "mid", content: "X".repeat(350), priority: 5 },
      { id: "lo", content: "X".repeat(200), priority: 1 }
    ];

    // tokenBudget 是字符预算, estimateTokens = chars/2
    // hi=600chars(300tokens), mid=350chars(175tokens), lo=200chars(100tokens), total 1150chars
    const result = applyTokenBudget({ items, tokenBudget: 480 });

    expect(result.included).toHaveLength(2);
    expect(result.included[0]!.id).toBe("hi");
    expect(result.included[1]!.id).toBe("mid");
    expect(result.trimmed).toHaveLength(1);
    expect(result.trimmed[0]!.id).toBe("lo");
  });

  it("trims item over budget and reports usage correctly", () => {
    const items: BudgetItem[] = [
      { id: "a", content: "x".repeat(200), priority: 10 }
    ];

    // 200 chars = ~100 tokens > 50 token budget → trimmed, usage=0
    const result = applyTokenBudget({ items, tokenBudget: 50 });

    expect(result.estimatedTokens).toBe(0);
    expect(result.trimmed).toHaveLength(1);
    expect(result.included).toHaveLength(0);
  });
});
