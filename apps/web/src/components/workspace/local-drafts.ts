export interface DraftScope { organizationId: string; userId: string; chapterId: string }
interface LocalDraft extends DraftScope { version: 1 | 2; writer: string; revision: string; content: string; baseHash: string; updatedAt: number }
export interface DraftReceipt { key: string; raw: string; draft: LocalDraft }
type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const prefix = (scope: DraftScope, version: 1 | 2) => `ai-novel:unsaved:v${version}:${encodeURIComponent(scope.organizationId)}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.chapterId)}:`;
const revisionKey = (draft: LocalDraft) => prefix(draft, 2) + `${encodeURIComponent(draft.writer)}:${draft.revision}`;
const handledKey = (draft: LocalDraft) => prefix(draft, 1) + `handled:${encodeURIComponent(draft.writer)}:${draft.revision}`;
export function saveLocalDraft(storage: DraftStorage, scope: DraftScope, writer: string, content: string, baseHash: string, updatedAt = Date.now()): DraftReceipt {
  const draft: LocalDraft = { ...scope, version: 2, writer, revision: crypto.randomUUID(), content, baseHash, updatedAt };
  const key = revisionKey(draft), raw = JSON.stringify(draft);
  // The caller may remove its prior immutable revision only after this succeeds.
  storage.setItem(key, raw);
  return { key, raw, draft };
}
export function inspectLocalDrafts(storage: DraftStorage, scope: DraftScope, remoteContent?: string): { latest: DraftReceipt | null; recoverableCount: number; estimatedBytes: number } {
  let latest: DraftReceipt | null = null, recoverableCount = 0, estimatedBytes = 0;
  // Snapshot keys first: another page can change storage while it is being read.
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (!key || ![1, 2].some(version => key.startsWith(prefix(scope, version as 1 | 2)))) continue;
    const raw = storage.getItem(key); if (!raw) continue;
    estimatedBytes += (key.length + raw.length) * 2;
    let value: unknown; try { value = JSON.parse(raw); } catch { continue; }
    if (!value || typeof value !== "object") continue;
    const draft = value as LocalDraft;
    if (![1, 2].includes(draft.version) || draft.organizationId !== scope.organizationId || draft.userId !== scope.userId || draft.chapterId !== scope.chapterId || typeof draft.writer !== "string" || typeof draft.revision !== "string" || !/^[0-9a-f-]{36}$/i.test(draft.revision) || typeof draft.content !== "string" || !/^[a-f0-9]{64}$/i.test(draft.baseHash) || !Number.isFinite(draft.updatedAt)) continue;
    if (draft.version === 2 ? key !== revisionKey(draft) : key !== prefix(scope, 1) + encodeURIComponent(draft.writer)) continue;
    if (draft.version === 1 && storage.getItem(handledKey(draft))) continue;
    if (draft.content === remoteContent) continue;
    recoverableCount++;
    if (!latest || draft.updatedAt > latest.draft.updatedAt || (draft.updatedAt === latest.draft.updatedAt && key > latest.key)) latest = { key, raw, draft };
  }
  return { latest, recoverableCount, estimatedBytes };
}
export function findLocalDraft(storage: DraftStorage, scope: DraftScope, remoteContent?: string): DraftReceipt | null {
  return inspectLocalDrafts(storage, scope, remoteContent).latest;
}
export function markLocalDraftHandled(storage: DraftStorage, receipt: DraftReceipt): void {
  if (receipt.draft.version === 2) { removeLocalDraft(storage, receipt); return; }
  // Legacy writer keys are mutable. Preserve their later edits with an immutable
  // handled marker; never compare-then-delete another page's legacy key.
  storage.setItem(handledKey(receipt.draft), "1");
}
export function removeLocalDraft(storage: DraftStorage, receipt: DraftReceipt): boolean {
  if (storage.getItem(receipt.key) !== receipt.raw) return false;
  storage.removeItem(receipt.key); return true;
}
