import { describe, expect, it } from "vitest";
import { labelForGenerationJobType } from "./display-labels";

describe("display labels", () => {
  it("labels diagnostic generation job types", () => {
    expect(labelForGenerationJobType("DIAGNOSE_CHAPTER")).toBe("质量诊断");
    expect(labelForGenerationJobType("READER_SIMULATION")).toBe("读者模拟");
    expect(labelForGenerationJobType("STYLE_DRIFT_CHECK")).toBe("风格漂移");
    expect(labelForGenerationJobType("CONTINUITY_CHECK")).toBe("连续性检查");
  });
});
