import { describe, expect, it } from "vitest";
import { dollarsToCents } from "./performance-budget-input";

describe("performance budget input", () => {
  it("keeps blank values unset and converts exact dollars to integer cents", () => {
    expect(dollarsToCents(" ")).toBeNull();
    expect(dollarsToCents("5")).toBe(500);
    expect(dollarsToCents("5.01")).toBe(501);
    expect(dollarsToCents("0.01")).toBe(1);
  });

  it.each(["0", "-1", "1.001", "1e2", "5usd", "Infinity", "abc", "21474836.48"])("rejects invalid or unsupported currency input %s", (value) => {
    expect(() => dollarsToCents(value)).toThrow("请输入大于 0 且最多两位小数的金额");
  });
});