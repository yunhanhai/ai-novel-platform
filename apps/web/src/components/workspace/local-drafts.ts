export interface DraftScope { organizationId: string; userId: string; chapterId: string }
interface LocalDraft extends DraftScope { version: 1; writer: string; revision: string; content: string; baseHash: string; updatedAt: number }
export interface DraftReceipt { key: string; raw: string; draft: LocalDraft }
type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const prefix = (scope: DraftScope) => `ai-novel:unsaved:v1:${encodeURIComponent(scope.organizationId)}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.chapterId)}:`;
export function saveLocalDraft(storage: DraftStorage, scope: DraftScope, writer: string, content: string, baseHash: string, updatedAt = Date.now()): DraftReceipt {
  const draft: LocalDraft = { ...scope, version: 1, writer, revision: crypto.randomUUID(), content, baseHash, updatedAt };
  const key = prefix(scope) + encodeURIComponent(writer), raw = JSON.stringify(draft);
  storage.setItem(key, raw);
  return { key, raw, draft };
}
export function findLocalDraft(storage: DraftStorage, scope: DraftScope, remoteContent?: string): DraftReceipt | null {
  let latest: DraftReceipt | null = null;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i); if (!key?.startsWith(prefix(scope))) continue;
    const raw = storage.getItem(key); if (!raw) continue;
    let value: unknown; try { value = JSON.parse(raw); } catch { continue; }
    if (!value || typeof value !== "object") continue;
    const draft = value as LocalDraft;
    if (draft.version !== 1 || draft.organizationId !== scope.organizationId || draft.userId !== scope.userId || draft.chapterId !== scope.chapterId || typeof draft.writer !== "string" || typeof draft.revision !== "string" || !/^[0-9a-f-]{36}$/i.test(draft.revision) || typeof draft.content !== "string" || !/^[a-f0-9]{64}$/i.test(draft.baseHash) || !Number.isFinite(draft.updatedAt)) continue;
    if (storage.getItem(handledKey(draft))) continue;
    if (draft.content === remoteContent) continue;
    if (!latest || draft.updatedAt > latest.draft.updatedAt || (draft.updatedAt === latest.draft.updatedAt && key > latest.key)) latest = { key, raw, draft };
  }
  return latest;
}
const handledKey = (draft: LocalDraft) => prefix(draft) + `handled:${encodeURIComponent(draft.writer)}:${draft.revision}`;
// Other pages may update their writer key at any time. Mark only this immutable
// revision as handled; never compare-then-delete another page's mutable key.
export function markLocalDraftHandled(storage: DraftStorage, receipt: DraftReceipt): void {
  storage.setItem(handledKey(receipt.draft), "1");
}
export function removeLocalDraft(storage: DraftStorage, receipt: DraftReceipt): boolean {
  if (storage.getItem(receipt.key) !== receipt.raw) return false;
  storage.removeItem(receipt.key); return true;
}
