import { describe, expect, it } from "vitest";
import { parseDeslopReport } from "./deslop-report";
const source = "她仿佛听见门响。";
const valid = { issues: [{ category: "stock_phrase", severity: "warning", matched: "仿佛", suggestion: "改为可观察动作", position: { start: 1, end: 3 } }], overallScore: 80, summary: "一处可能的套话" };
describe("deslop report evidence", () => {
  it("accepts complete JSON and anchored code fences", () => {
    expect(parseDeslopReport(JSON.stringify(valid), source)).toEqual(valid);
    expect(parseDeslopReport(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, source)).toEqual(valid);
  });
  it.each(["散文", "{}", "[]", JSON.stringify({ ...valid, overallScore: 101 }), JSON.stringify({ ...valid, overallScore: "80" }), JSON.stringify({ ...valid, summary: " " }), JSON.stringify({ ...valid, issues: [{}] }), JSON.stringify([valid])])("rejects incomplete or invalid output: %s", text => {
    expect(parseDeslopReport(text, source)).toBeNull();
  });
  it("corrects an approximate position only for an exact unique quote", () => {
    const report = { ...valid, issues: [{ ...valid.issues[0]!, position: { start: 0, end: 0 } }] };
    expect(parseDeslopReport(JSON.stringify(report), source)?.issues[0]?.position).toEqual({ start: 1, end: 3 });
    expect(parseDeslopReport(JSON.stringify(report), `${source}${source}`)).toBeNull();
  });
  it("rejects invented quotes and malformed position/category/severity", () => {
    for (const issue of [ { ...valid.issues[0]!, matched: "正文不存在" }, { ...valid.issues[0]!, category: "invented" }, { ...valid.issues[0]!, severity: "fatal" }, { ...valid.issues[0]!, position: { start: -1, end: 3 } } ]) {
      expect(parseDeslopReport(JSON.stringify({ ...valid, issues: [issue] }), source)).toBeNull();
    }
  });
  it("uses original UTF16 offsets for emoji-containing text", () => {
    const report = { ...valid, issues: [{ ...valid.issues[0]!, position: { start: 0, end: 0 } }] };
    expect(parseDeslopReport(JSON.stringify(report), `😀${source}`)?.issues[0]?.position).toEqual({ start: 3, end: 5 });
  });
});
