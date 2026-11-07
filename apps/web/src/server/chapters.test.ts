import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createVolume,
  createChapter,
  updateChapterContent,
  saveContentVersion,
  applyDeslopEdit,
  findChaptersByProject
} from "./chapters";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const txClient = {
    projectMemory: {updateMany: vi.fn().mockResolvedValue({count:0})},
    chapter: { findFirst: vi.fn(), update: vi.fn() },
    contentVersion: { findFirst: vi.fn(), create: vi.fn() }
  };
  const prisma = {
    projectMemory: {updateMany: vi.fn().mockResolvedValue({count:0})},
    volume: { create: vi.fn() },
    chapter: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    contentVersion: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
    _tx: txClient,
    ...overrides
  } as unknown as Parameters<typeof createVolume>[0]["prisma"] & {
    _tx: typeof txClient;
    $transaction: ReturnType<typeof vi.fn>;
  };
  Object.assign(txClient, {$queryRaw: vi.fn(async()=>[await txClient.chapter.findFirst()])});
  Object.assign(prisma, {$queryRaw: vi.fn(async()=>[await prisma.chapter.findFirst()])});
  return prisma;
}

const volume = { id: "v1", organizationId: "org1", projectId: "p1", title: "第一卷", orderIndex: 1 };
const chapter = {
  id: "c1", organizationId: "org1", projectId: "p1", volumeId: "v1",
  chapterNo: 1, title: "第一章", wordCount: 0, content: "",
  status: "DRAFT", createdById: "u1"
};

describe("chapters", () => {
  describe("createVolume", () => {
    it("creates a volume scoped to project", async () => {
      const prisma = mockPrisma({ volume: { create: vi.fn().mockResolvedValue(volume) } });

      const result = await createVolume({
        organizationId: "org1", projectId: "p1", title: "第一卷",
        orderIndex: 1, prisma
      });

      expect(result.title).toBe("第一卷");
    });
  });

  describe("createChapter", () => {
    it("creates a chapter with sequential chapterNo", async () => {
      const prisma = mockPrisma({ chapter: { create: vi.fn().mockResolvedValue(chapter) } });

      const result = await createChapter({
        organizationId: "org1", projectId: "p1", volumeId: "v1",
        chapterNo: 1, title: "第一章", createdById: "u1", prisma
      });

      expect(result.chapterNo).toBe(1);
    });
  });

  describe("updateChapterContent", () => {
    function txForUpdate(updated: unknown) {
      const prisma = mockPrisma({
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: null }),
          update: vi.fn().mockResolvedValue(updated)
        },
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0)
        }
      });
      // 事务 mock：把 prisma 自身作为 tx 传入
      (prisma as unknown as Record<string, unknown>).$transaction = vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)
      );
      return prisma;
    }

    it("updates chapter content and word count", async () => {
      const updated = { ...chapter, content: "正文内容", wordCount: 500 };
      const prisma = txForUpdate(updated);

      const result = await updateChapterContent({
        organizationId: "org1", chapterId: "c1",
        content: "正文内容", wordCount: 500, updatedById: "u1", prisma
      });

      expect(result.chapter.wordCount).toBe(500);
      // 首次保存（旧正文为空）：只更新章节，不写快照版本
      expect(result.snapshotCreated).toBe(false);
    });

    it("snapshots a MANUAL version after a large edit past the throttle window", async () => {
      const updated = { ...chapter, content: "大幅改写后的正文内容", wordCount: 900 };
      const prisma = mockPrisma({
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: "原始的旧正文内容" }),
          update: vi.fn().mockResolvedValue(updated)
        },
        contentVersion: {
          // 上一版本是 11 分钟前的 AI 版本，内容与本次完全不同
          findFirst: vi.fn().mockResolvedValue({
            versionNo: 3,
            content: "完全不同的旧版本内容",
            createdAt: new Date(Date.now() - 11 * 60 * 1000)
          }),
          count: vi.fn().mockResolvedValue(5),
          create: vi.fn().mockResolvedValue({ id: "cv-new", versionNo: 4 })
        }
      });
      (prisma as unknown as Record<string, unknown>).$transaction = vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)
      );

      const result = await updateChapterContent({
        organizationId: "org1", chapterId: "c1",
        content: "大幅改写后的正文内容", wordCount: 900, updatedById: "u1", prisma
      });

      expect(result.snapshotCreated).toBe(true);
      const cv = (prisma as unknown as {
        contentVersion: { create: ReturnType<typeof vi.fn> };
      }).contentVersion.create;
      expect(cv).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: "MANUAL",
          content: "大幅改写后的正文内容"
        })
      });
    });

    it("does not snapshot a minor edit even past the throttle window", async () => {
      const oldContent = "这是一段足够长的旧正文内容，用来构造一个修改幅度低于快照阈值的场景。".repeat(2);
      const newContent = oldContent.slice(0, -2) + "两字";
      const updated = { ...chapter, content: newContent, wordCount: 100 };
      const prisma = mockPrisma({
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: oldContent }),
          update: vi.fn().mockResolvedValue(updated)
        },
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue({
            versionNo: 3,
            content: oldContent,
            createdAt: new Date(Date.now() - 11 * 60 * 1000)
          }),
          count: vi.fn().mockResolvedValue(5),
          create: vi.fn()
        }
      });
      (prisma as unknown as Record<string, unknown>).$transaction = vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)
      );

      const result = await updateChapterContent({
        organizationId: "org1", chapterId: "c1",
        content: newContent, wordCount: 100, updatedById: "u1", prisma
      });

      expect(result.snapshotCreated).toBe(false);
      expect(
        (prisma as unknown as { contentVersion: { create: ReturnType<typeof vi.fn> } }).contentVersion.create
      ).not.toHaveBeenCalled();
    });

    it("does not snapshot inside the throttle window", async () => {
      const oldContent = "节流窗口内的旧正文内容。";
      const updated = { ...chapter, content: "完全不同的新正文。", wordCount: 100 };
      const prisma = mockPrisma({
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: oldContent }),
          update: vi.fn().mockResolvedValue(updated)
        },
        contentVersion: {
          // 上一版本 2 分钟前 → 节流窗口内
          findFirst: vi.fn().mockResolvedValue({
            versionNo: 3,
            content: oldContent,
            createdAt: new Date(Date.now() - 2 * 60 * 1000)
          }),
          count: vi.fn().mockResolvedValue(5),
          create: vi.fn()
        }
      });
      (prisma as unknown as Record<string, unknown>).$transaction = vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)
      );

      const result = await updateChapterContent({
        organizationId: "org1", chapterId: "c1",
        content: "完全不同的新正文。", wordCount: 100, updatedById: "u1", prisma
      });

      expect(result.snapshotCreated).toBe(false);
    });

    it("does not snapshot when the version cap is reached", async () => {
      const updated = { ...chapter, content: "上限后的修改", wordCount: 100 };
      const prisma = mockPrisma({
        chapter: {
          findFirst: vi.fn().mockResolvedValue({ id: "c1", projectId: "p1", content: "旧正文" }),
          update: vi.fn().mockResolvedValue(updated)
        },
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue({
            versionNo: 100,
            content: "完全不同的旧版本内容",
            createdAt: new Date(Date.now() - 11 * 60 * 1000)
          }),
          count: vi.fn().mockResolvedValue(100),
          create: vi.fn()
        }
      });
      (prisma as unknown as Record<string, unknown>).$transaction = vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)
      );

      const result = await updateChapterContent({
        organizationId: "org1", chapterId: "c1",
        content: "上限后的修改", wordCount: 100, updatedById: "u1", prisma
      });

      expect(result.snapshotCreated).toBe(false);
      expect(
        (prisma as unknown as { contentVersion: { create: ReturnType<typeof vi.fn> } }).contentVersion.create
      ).not.toHaveBeenCalled();
    });
  });

  describe("saveContentVersion", () => {
    it("saves version with auto-incremented versionNo", async () => {
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue({ versionNo: 2 }),
          create: vi.fn().mockResolvedValue({ id: "cv1", versionNo: 3 })
        }
      });

      const result = await saveContentVersion({
        organizationId: "org1", projectId: "p1", chapterId: "c1",
        content: "内容", source: "AI", createdById: "u1", prisma
      });

      expect(result.versionNo).toBe(3);
    });

    it("starts from versionNo 1 when no prior versions", async () => {
      const prisma = mockPrisma({
        contentVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "cv1", versionNo: 1 })
        }
      });

      const result = await saveContentVersion({
        organizationId: "org1", projectId: "p1", chapterId: "c1",
        content: "内容", source: "MANUAL", createdById: "u1", prisma
      });

      expect(result.versionNo).toBe(1);
    });
  });

  describe("applyDeslopEdit", () => {
    it("snapshots current content, updates chapter, and saves the edited content in one transaction", async () => {
      const prisma = mockPrisma();
      const existing = { ...chapter, content: "仿佛一切都静止了", wordCount: 9, updatedAt: new Date() };
      const updated = { ...chapter, content: "一切都静止了", wordCount: 6, updatedAt: new Date() };
      prisma._tx.chapter.findFirst.mockResolvedValue(existing);
      prisma._tx.contentVersion.findFirst.mockResolvedValue({ versionNo: 2, content: "旧版本" });
      prisma._tx.chapter.update.mockResolvedValue(updated);
      prisma._tx.contentVersion.create
        .mockResolvedValueOnce({ id: "before", versionNo: 3 })
        .mockResolvedValueOnce({ id: "after", versionNo: 4 });

      const result = await applyDeslopEdit({
        organizationId: "org1",
        chapterId: "c1",
        nextContent: "一切都静止了",
        baseContentHash: sha256Hex(existing.content),
        updatedById: "u1",
        matchedText: "仿佛",
        category: "stock_phrase",
        prisma
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma._tx.contentVersion.create).toHaveBeenCalledTimes(2);
      expect(prisma._tx.contentVersion.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
        data: expect.objectContaining({
          versionNo: 3,
          content: existing.content,
          source: "MANUAL",
          title: "Before DESLOP apply"
        })
      }));
      expect(prisma._tx.chapter.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ content: "一切都静止了", updatedById: "u1" })
      }));
      expect(prisma._tx.contentVersion.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
        data: expect.objectContaining({
          versionNo: 4,
          content: "一切都静止了",
          source: "AI",
          title: "DESLOP apply: stock_phrase / 仿佛"
        })
      }));
      expect(result.chapter).toBe(updated);
      expect(result.version.versionNo).toBe(4);
    });

    it("rejects stale deslop edits when the chapter content hash changed", async () => {
      const prisma = mockPrisma();
      prisma._tx.chapter.findFirst.mockResolvedValue({ ...chapter, content: "当前正文" });

      await expect(applyDeslopEdit({
        organizationId: "org1",
        chapterId: "c1",
        nextContent: "新正文",
        baseContentHash: sha256Hex("旧正文"),
        updatedById: "u1",
        prisma
      })).rejects.toThrow("CHAPTER_CONTENT_STALE");

      expect(prisma._tx.chapter.update).not.toHaveBeenCalled();
      expect(prisma._tx.contentVersion.create).not.toHaveBeenCalled();
    });

    it("truncates the DESLOP version title to fit the database limit", async () => {
      const prisma = mockPrisma();
      const existing = { ...chapter, content: "仿佛一切都静止了" };
      prisma._tx.chapter.findFirst.mockResolvedValue(existing);
      prisma._tx.contentVersion.findFirst.mockResolvedValue({ versionNo: 0, content: existing.content });
      prisma._tx.chapter.update.mockResolvedValue({ ...chapter, content: "一切都静止了" });
      prisma._tx.contentVersion.create.mockResolvedValue({ id: "after", versionNo: 1 });

      await applyDeslopEdit({
        organizationId: "org1",
        chapterId: "c1",
        nextContent: "一切都静止了",
        baseContentHash: sha256Hex(existing.content),
        updatedById: "u1",
        matchedText: "很长".repeat(120),
        category: "stock_phrase",
        prisma
      });

      const created = prisma._tx.contentVersion.create.mock.calls.at(-1)?.[0] as { data: { title: string } };
      expect(created.data.title).toHaveLength(200);
      expect(created.data.title.endsWith("...")).toBe(true);
    });
  });

  describe("findChaptersByProject", () => {
    it("returns chapters ordered by chapterNo", async () => {
      const prisma = mockPrisma({ chapter: { findMany: vi.fn().mockResolvedValue([chapter]) } });

      const result = await findChaptersByProject("org1", "p1", prisma);

      expect(result).toHaveLength(1);
    });
  });
});

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

it.each([true,false])("invalidates derived memories only for changed manual content: %s",async changed=>{
 const old="原正文";const content=changed?"新正文":old;
 const tx={chapter:{findFirst:vi.fn().mockResolvedValue({id:"c1",projectId:"p1",content:old}),update:vi.fn().mockResolvedValue({id:"c1",content})},$queryRaw:vi.fn().mockResolvedValue([{id:"c1",projectId:"p1",content:old}]),projectMemory:{updateMany:vi.fn().mockResolvedValue({count:1})},contentVersion:{findFirst:vi.fn().mockResolvedValue({versionNo:1,content:old,createdAt:new Date()}),count:vi.fn().mockResolvedValue(1)}};
 const prisma={$transaction:async(cb:any)=>cb(tx)};
 await updateChapterContent({organizationId:"org1",chapterId:"c1",content,wordCount:3,updatedById:"u1",prisma:prisma as never});
 if(changed)expect(tx.projectMemory.updateMany).toHaveBeenCalledWith({where:{organizationId:"org1",projectId:"p1",sourceChapterId:"c1",status:{in:["proposed","accepted"]}},data:{status:"superseded"}});
 else expect(tx.projectMemory.updateMany).not.toHaveBeenCalled();
});
it("supersedes source memories in the soft-delete transaction",async()=>{
 const {softDeleteChapter}=await import("./chapters");
 const tx={chapter:{update:vi.fn().mockResolvedValue({id:"c1",deletedAt:new Date()})},$queryRaw:vi.fn().mockResolvedValue([{id:"c1",projectId:"p1",content:"正文"}]),projectMemory:{updateMany:vi.fn().mockResolvedValue({count:2})}};
 const prisma={$transaction:vi.fn(async(cb:any)=>cb(tx))};
 await softDeleteChapter("org1","c1",prisma as never);
 expect(prisma.$transaction).toHaveBeenCalledTimes(1);
 expect(tx.projectMemory.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:"org1",projectId:"p1",sourceChapterId:"c1"}),data:{status:"superseded"}}));
});

it("propagates memory-invalidation failures so the chapter write transaction can roll back",async()=>{
 const failure=new Error("memory database failure");
 const tx={$queryRaw:vi.fn().mockResolvedValue([{id:"c1",projectId:"p1",content:"旧正文"}]),chapter:{update:vi.fn().mockResolvedValue({})},projectMemory:{updateMany:vi.fn().mockRejectedValue(failure)},contentVersion:{findFirst:vi.fn().mockResolvedValue({createdAt:new Date()}),count:vi.fn()}};
 await expect(updateChapterContent({organizationId:"org1",chapterId:"c1",content:"新正文",wordCount:3,updatedById:"u1",prisma:{$transaction:async(cb:any)=>cb(tx)} as never})).rejects.toBe(failure);
});
it("rejects stale manual saves before versions or memory invalidation", async () => {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: "c1", projectId: "p1", content: "另一页面的新稿" }]), chapter: { update: vi.fn() }, contentVersion: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), create: vi.fn() }, projectMemory: { updateMany: vi.fn() } };
  await expect(updateChapterContent({ organizationId: "org1", chapterId: "c1", content: "旧页面覆盖稿", wordCount: 6, updatedById: "u1", baseContentHash: createHash("sha256").update("共同旧稿").digest("hex"), prisma: { $transaction: async(cb: any)=>cb(tx) } as never } as Parameters<typeof updateChapterContent>[0])).rejects.toThrow("CHAPTER_CONTENT_STALE");
  expect(tx.chapter.update).not.toHaveBeenCalled(); expect(tx.contentVersion.create).not.toHaveBeenCalled(); expect(tx.projectMemory.updateMany).not.toHaveBeenCalled();
});

it("does not create a manual snapshot for a one-character edit in a long chapter",async()=>{
 const before='甲'.repeat(10000)+'原'+'乙'.repeat(9999),after=before.replace('原','新');
 const tx={$queryRaw:vi.fn().mockResolvedValue([{id:'c1',projectId:'p1',content:before}]),chapter:{update:vi.fn().mockResolvedValue({...chapter,content:after})},contentVersion:{findFirst:vi.fn().mockResolvedValue({versionNo:1,content:before,createdAt:new Date(Date.now()-11*60000)}),count:vi.fn().mockResolvedValue(1),create:vi.fn()},projectMemory:{updateMany:vi.fn().mockResolvedValue({count:0})}};
 const saved=await updateChapterContent({organizationId:'org1',chapterId:'c1',content:after,wordCount:after.length,updatedById:'u1',baseContentHash:createHash('sha256').update(before).digest('hex'),prisma:{$transaction:async(cb:any)=>cb(tx)} as never});
 expect(saved.snapshotCreated).toBe(false);expect(tx.contentVersion.create).not.toHaveBeenCalled();expect(tx.chapter.update).toHaveBeenCalledOnce();expect(tx.projectMemory.updateMany).toHaveBeenCalledOnce();
});
