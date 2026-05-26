import { describe, expect, it } from "vitest";
import { formatLatency, formatTokens, formatTrendWindowLabel } from "./performance-trends-format";

describe("performance trend formatting", () => {
  it("formats token counts compactly", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(1_250_000)).toBe("1.3m");
  });

  it("formats missing latency as dash", () => {
    expect(formatLatency(null)).toBe("-");
  });

  it("formats latency as rounded milliseconds", () => {
    expect(formatLatency(1234.4)).toBe("1234ms");
    expect(formatLatency(1234.5)).toBe("1235ms");
  });

  it("formats trend windows for compact controls", () => {
    expect(formatTrendWindowLabel("7d")).toBe("7 天");
    expect(formatTrendWindowLabel("30d")).toBe("30 天");
  });
});
