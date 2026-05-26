import { describe, expect, it } from "vitest";
import {
  getMaxDailyCalls,
  isOrganizationPerformanceEmpty,
  toBreakdownItems
} from "./organization-performance-overview-model";
import type { PerformanceTrends } from "../workspace/use-workspace-data";

function trends(calls: number): PerformanceTrends {
  return {
    scope: "organization",
    window: "30d",
    totals: {
      calls,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencySamples: 0,
      averageLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
      estimatedCostCents: null
    },
    daily: [],
    byModel: [],
    byProvider: [],
    byBillingSource: [],
    byJobType: []
  };
}

describe("organization performance overview model", () => {
  it("treats zero calls as an empty organization trend", () => {
    expect(isOrganizationPerformanceEmpty(trends(0))).toBe(true);
    expect(isOrganizationPerformanceEmpty(trends(1))).toBe(false);
    expect(isOrganizationPerformanceEmpty(null)).toBe(false);
  });

  it("keeps max daily calls at least one for stable bar widths", () => {
    expect(getMaxDailyCalls([])).toBe(1);
    expect(getMaxDailyCalls([{ calls: 0 }, { calls: 0 }])).toBe(1);
    expect(getMaxDailyCalls([{ calls: 2 }, { calls: 5 }])).toBe(5);
  });

  it("maps and limits breakdown items", () => {
    const items = toBreakdownItems(
      [
        { id: "a", calls: 3 },
        { id: "b", calls: 2 },
        { id: "c", calls: 1 }
      ],
      2,
      (item) => ({
        key: item.id,
        label: item.id.toUpperCase(),
        meta: `${item.calls} 次`
      })
    );

    expect(items).toEqual([
      { key: "a", label: "A", meta: "3 次" },
      { key: "b", label: "B", meta: "2 次" }
    ]);
  });
});
