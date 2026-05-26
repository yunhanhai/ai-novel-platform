import type { PerformanceTrends } from "../workspace/use-workspace-data";

export interface BreakdownDisplayItem {
  key: string;
  label: string;
  meta: string;
}

export function isOrganizationPerformanceEmpty(trends: PerformanceTrends | null): boolean {
  return trends !== null && trends.totals.calls === 0;
}

export function getMaxDailyCalls(days: Array<{ calls: number }>): number {
  return Math.max(...days.map((day) => day.calls), 1);
}

export function toBreakdownItems<T>(
  items: T[],
  limit: number,
  mapper: (item: T) => BreakdownDisplayItem
): BreakdownDisplayItem[] {
  return items.slice(0, limit).map(mapper);
}
