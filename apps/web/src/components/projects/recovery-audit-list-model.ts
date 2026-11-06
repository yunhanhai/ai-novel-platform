import { labelForGenerationJobStatus } from "../../lib/display-labels";
import type { RecoveryAuditAction, RecoveryAuditItem, RecoveryAuditList } from "../../server/recovery-audit";

export function getRecoveryActionDisplay(action: RecoveryAuditAction): { label: string; tone: string } {
  if (action === "queue.recover_expired_leases") {
    return { label: "回收过期租约", tone: "recover" };
  }
  return { label: "重试失败任务", tone: "retry" };
}

export function getRecoveryMetadataSummary(item: RecoveryAuditItem): string {
  if (item.action === "queue.recover_expired_leases") {
    const recovered = asNumber(item.metadata.recovered);
    const failed = asNumber(item.metadata.failed);
    if (recovered !== null || failed !== null) {
      return `恢复 ${recovered ?? 0} 个，失败 ${failed ?? 0} 个`;
    }
  }

  const resultingStatus = asString(item.metadata.resultingStatus);
  if (resultingStatus) return `结果 ${labelForGenerationJobStatus(resultingStatus)}`;

  return "无摘要";
}

export function getRecoveryActorLabel(item: Pick<RecoveryAuditItem, "actorDisplayName">): string {
  return item.actorDisplayName || "系统";
}

export function formatRecoveryAuditTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function isRecoveryAuditEmpty(data: RecoveryAuditList | null): boolean {
  return data !== null && data.items.length === 0;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
