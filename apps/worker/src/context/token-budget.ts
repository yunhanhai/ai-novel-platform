interface BudgetItem {
  id: string;
  content: string;
  priority: number;
}

interface BudgetResult {
  included: BudgetItem[];
  trimmed: BudgetItem[];
  estimatedTokens: number;
  tokenBudget: number;
}

interface ApplyBudgetParams {
  items: BudgetItem[];
  tokenBudget: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export function applyTokenBudget({ items, tokenBudget }: ApplyBudgetParams): BudgetResult {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const included: BudgetItem[] = [];
  const trimmed: BudgetItem[] = [];
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
