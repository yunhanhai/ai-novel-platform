import { describe, expect, it, vi } from "vitest";
import { sanitizeServerMessage } from "./api-errors";

describe("sanitizeServerMessage", () => {
  it("keeps operational CJK messages visible to the caller", () => {
    expect(sanitizeServerMessage("章节不存在")).toBe("章节不存在");
  });

  it("keeps mixed messages that carry CJK content", () => {
    expect(sanitizeServerMessage("projectId 与 chapterId 必须提供其一")).toBe(
      "projectId 与 chapterId 必须提供其一"
    );
  });

  it("hides infrastructure errors that are pure ASCII", () => {
    expect(sanitizeServerMessage("Error invoking task: ECONNREFUSED 127.0.0.1:5432")).toBe(
      "服务器内部错误"
    );
  });

  it("hides empty and missing messages", () => {
    expect(sanitizeServerMessage(null)).toBe("服务器内部错误");
    expect(sanitizeServerMessage("")).toBe("服务器内部错误");
    expect(sanitizeServerMessage("   ")).toBe("服务器内部错误");
  });
});
