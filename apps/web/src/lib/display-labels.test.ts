import { describe, expect, it } from "vitest";
import {
  labelForChapterStatus,
  labelForGenerationJobStatus,
  labelForGenerationJobType,
  labelForPipelineStep,
  labelForProviderStatus,
  labelForTaskType
} from "./display-labels";

describe("display labels", () => {
  it("translates common backend enums for the UI", () => {
    expect(labelForChapterStatus("PLANNED")).toBe("待写");
    expect(labelForProviderStatus("DISABLED")).toBe("已停用");
    expect(labelForGenerationJobType("GENERATE_CHAPTER")).toBe("生成章节");
    expect(labelForGenerationJobStatus("SUCCEEDED")).toBe("已完成");
    expect(labelForTaskType("extract_memory")).toBe("抽取记忆");
    expect(labelForPipelineStep("persist_version")).toBe("保存版本");
  });

  it("keeps unknown values visible for diagnostics", () => {
    expect(labelForGenerationJobStatus("CUSTOM_STATUS")).toBe("CUSTOM_STATUS");
  });
});
