import { describe, expect, it } from "vitest";
import {
  formatRecoveryAuditTime,
  getRecoveryActionDisplay,
  getRecoveryActorLabel,
  getRecoveryMetadataSummary,
  isRecoveryAuditEmpty
} from "./recovery-audit-list-model";
import type { RecoveryAuditItem, RecoveryAuditList } from "../../server/recovery-audit";

function item(overrides: Partial<RecoveryAuditItem> = {}): RecoveryAuditItem {
  return {
    id: "audit-1",
    action: "generation_job.retry",
    entityType: "generation_job",
    entityId: "job-1",
    actorDisplayName: "Ops User",
    metadata: { resultingStatus: "QUEUED" },
    createdAt: "2026-05-29T10:05:00.000Z",
    ...overrides
  };
}

function list(items: RecoveryAuditItem[]): RecoveryAuditList {
  return {
    items,
    total: items.length
  };
}

describe("recovery audit list model", () => {
  it("labels recovery actions with stable tones", () => {
    expect(getRecoveryActionDisplay("generation_job.retry")).toEqual({
      label: "重试失败任务",
      tone: "retry"
    });
    expect(getRecoveryActionDisplay("queue.recover_expired_leases")).toEqual({
      label: "回收过期租约",
      tone: "recover"
    });
  });

  it("summarizes safe metadata for each action", () => {
    expect(getRecoveryMetadataSummary(item())).toBe("结果 排队中");
    expect(getRecoveryMetadataSummary(item({
      action: "queue.recover_expired_leases",
      metadata: { recovered: 2, failed: 1 }
    }))).toBe("恢复 2 个，失败 1 个");
  });

  it("falls back when actor or metadata is missing", () => {
    expect(getRecoveryActorLabel(item({ actorDisplayName: null }))).toBe("系统");
    expect(getRecoveryMetadataSummary(item({ metadata: {} }))).toBe("无摘要");
  });

  it("formats timestamps for compact display", () => {
    expect(formatRecoveryAuditTime("2026-05-29T10:05:00.000Z")).toMatch(/10:05|18:05/);
  });

  it("detects empty loaded audit data", () => {
    expect(isRecoveryAuditEmpty(null)).toBe(false);
    expect(isRecoveryAuditEmpty(list([]))).toBe(true);
    expect(isRecoveryAuditEmpty(list([item()]))).toBe(false);
  });
});
