import { createHash } from "node:crypto";

interface OutlineRevisionSource {
  id: string;
  organizationId: string;
  projectId: string;
  parentId?: string | null;
  level: string;
  title: string;
  summary?: string | null;
  orderIndex: number;
  status: string;
  targetChapterId?: string | null;
}

// A content fingerprint deliberately excludes timestamps. This is state CAS,
// so a duplicate acknowledgment can confirm the target without another write.
export function outlineRevisionHash(node: OutlineRevisionSource): string {
  return createHash("sha256").update(JSON.stringify([
    node.id, node.organizationId, node.projectId, node.parentId ?? null,
    node.level, node.title, node.summary ?? null, node.orderIndex,
    node.status, node.targetChapterId ?? null
  ])).digest("hex");
}

export function withOutlineRevision<T extends OutlineRevisionSource>(node: T): T & { revisionHash: string } {
  return { ...node, revisionHash: outlineRevisionHash(node) };
}

export class OutlineConflictError extends Error {
  constructor() { super("OUTLINE_REVISION_STALE"); }
}

export function requireOutlineBase(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error("大纲操作需要有效的 baseRevisionHash");
}
