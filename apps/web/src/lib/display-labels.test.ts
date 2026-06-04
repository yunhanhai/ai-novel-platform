import { describe, expect, it } from "vitest";
import {
  labelForAbandonRisk,
  labelForChapterStatus,
  labelForGenerationJobStatus,
  labelForGenerationJobType,
  labelForPipelineStep,
  labelForProviderStatus,
  labelForQualityMode,
  labelForSkipReason,
  labelForTaskType
} from "./display-labels";

describe("display labels", () => {
  it("translates common backend enums for the UI", () => {
    expect(labelForChapterStatus("PLANNED")).toBe("待写");
    expect(labelForProviderStatus("DISABLED")).toBe("已停用");
    expect(labelForGenerationJobType("GENERATE_CHAPTER")).toBe("生成章节");
    expect(labelForGenerationJobType("DIAGNOSE_CHAPTER")).toBe("质量诊断");
    expect(labelForGenerationJobStatus("SUCCEEDED")).toBe("已完成");
    expect(labelForTaskType("extract_memory")).toBe("抽取记忆");
    expect(labelForPipelineStep("persist_version")).toBe("保存版本");
    expect(labelForPipelineStep("diagnose_chapter")).toBe("质量诊断");
  });

  it("translates performance and diagnostic enums", () => {
    expect(labelForQualityMode("fast")).toBe("快速");
    expect(labelForQualityMode("balanced")).toBe("均衡");
    expect(labelForQualityMode("deep")).toBe("深度");
    expect(labelForAbandonRisk("high")).toBe("高");
    expect(labelForSkipReason("quality_mode")).toBe("质量模式跳过");
    expect(labelForSkipReason("budget_model_calls")).toBe("超出模型调用预算");
  });

  it("keeps unknown values visible for diagnostics", () => {
    expect(labelForGenerationJobStatus("CUSTOM_STATUS")).toBe("CUSTOM_STATUS");
    expect(labelForQualityMode("turbo")).toBe("turbo");
  });
});
