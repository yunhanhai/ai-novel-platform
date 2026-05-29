interface BudgetItem {
  id: string;
  content: string;
  priority: number;
}

interface BudgetResult<T extends BudgetItem> {
  included: T[];
  trimmed: T[];
  estimatedTokens: number;
  tokenBudget: number;
}

interface ApplyBudgetParams<T extends BudgetItem> {
  items: T[];
  tokenBudget: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export function applyTokenBudget<T extends BudgetItem>({ items, tokenBudget }: ApplyBudgetParams<T>): BudgetResult<T> {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const included: T[] = [];
  const trimmed: T[] = [];
  let used = 0;

  for (const item of sorted) {
    const tokens = estimateTokens(item.content);
    if (used + tokens <= tokenBudget) {
      included.push(item);
      used += tokens;
    } else {
      trimmed.push(item);
    }
  }

  return {
    included: included.sort((a, b) => b.priority - a.priority),
    trimmed,
    estimatedTokens: used,
    tokenBudget
  };
}
