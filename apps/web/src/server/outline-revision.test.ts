import { describe, expect, it } from "vitest";
import { outlineRevisionHash } from "./outline-revision";

const node = { id: "o1", organizationId: "org1", projectId: "p1", parentId: null, level: "CHAPTER", title: "原稿", summary: "摘要", orderIndex: 2, status: "PLANNED", targetChapterId: null };
describe("outline revision fingerprint", () => {
  it("is deterministic independently of object insertion and timestamps", () => {
    expect(outlineRevisionHash({ ...node, updatedAt: new Date() } as typeof node)).toBe(outlineRevisionHash({ ...node }));
    expect(outlineRevisionHash({ status: node.status, summary: node.summary, title: node.title, level: node.level, orderIndex: node.orderIndex, projectId: node.projectId, organizationId: node.organizationId, id: node.id })).toBe(outlineRevisionHash(node));
    expect(outlineRevisionHash(node)).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    { id: "o2" }, { organizationId: "org2" }, { projectId: "p2" }, { parentId: "p3" },
    { level: "VOLUME" }, { title: "新标题" }, { summary: "新摘要" }, { orderIndex: 3 },
    { status: "DONE" }, { targetChapterId: "c1" }, { summary: "" }
  ])("changes for protected field %j", change => { expect(outlineRevisionHash({ ...node, ...change })).not.toBe(outlineRevisionHash(node)); });
  it("distinguishes null summary from an explicitly empty summary", () => {
    expect(outlineRevisionHash({ ...node, summary: null })).not.toBe(outlineRevisionHash({ ...node, summary: "" }));
  });
});
