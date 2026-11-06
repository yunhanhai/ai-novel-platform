import type { PerformanceTrendWindow } from "../../server/performance-trends";

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatLatency(value: number | null): string {
  return value === null ? "-" : `${Math.round(value)}ms`;
}

export function formatCostCents(value: number | null): string {
  return value === null ? "-" : `$${(value / 100).toFixed(2)}`;
}

export function formatTrendWindowLabel(value: PerformanceTrendWindow): string {
  return value === "7d" ? "7 天" : "30 天";
}
