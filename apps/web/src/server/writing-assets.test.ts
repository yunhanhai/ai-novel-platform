import { describe, expect, it, vi } from "vitest";
import {
  createCharacter,
  findCharactersByProject,
  createWorldItem,
  findWorldItemsByProject,
  createPlotThread,
  findPlotThreadsByProject,
  createProjectMemory,
  findMemoriesByProject,
  setMemoryStatus
} from "./writing-assets";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    character: { create: vi.fn(), findMany: vi.fn() },
    characterRelationship: { create: vi.fn(), findMany: vi.fn() },
    worldItem: { create: vi.fn(), findMany: vi.fn() },
    plotThread: { create: vi.fn(), findMany: vi.fn() },
    projectMemory: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    ...overrides
  } as unknown as Parameters<typeof createCharacter>[0]["prisma"];
}

describe("writing-assets", () => {
  describe("characters", () => {
    it("creates a character with required fields", async () => {
      const ch = { id: "ch1", name: "林墨", roleType: "protagonist", projectId: "p1" };
      const prisma = mockPrisma({ character: { create: vi.fn().mockResolvedValue(ch) } });

      const result = await createCharacter({
        organizationId: "org1", projectId: "p1",
        name: "林墨", roleType: "protagonist",
        createdById: "u1", prisma
      });

      expect(result.name).toBe("林墨");
      expect(result.roleType).toBe("protagonist");
    });

    it("lists characters for a project", async () => {
      const prisma = mockPrisma({
        character: { findMany: vi.fn().mockResolvedValue([{ id: "ch1", name: "林墨" }]) }
      });

      const result = await findCharactersByProject("org1", "p1", prisma);

      expect(result).toHaveLength(1);
    });
  });

  describe("worldItems", () => {
    it("creates a world item with activation keywords", async () => {
      const wi = { id: "wi1", name: "青云山", itemType: "location", activationKeywords: ["青云", "仙山"] };
      const prisma = mockPrisma({ worldItem: { create: vi.fn().mockResolvedValue(wi) } });

      const result = await createWorldItem({
        organizationId: "org1", projectId: "p1",
        itemType: "location", name: "青云山",
        activationKeywords: ["青云", "仙山"],
        createdById: "u1", prisma
      });

      expect(result.activationKeywords).toEqual(["青云", "仙山"]);
    });
  });

  describe("plotThreads", () => {
    it("creates a plot thread", async () => {
      const pt = { id: "pt1", title: "主线伏笔", threadType: "foreshadowing", status: "planted" };
      const prisma = mockPrisma({ plotThread: { create: vi.fn().mockResolvedValue(pt) } });

      const result = await createPlotThread({
        organizationId: "org1", projectId: "p1",
        threadType: "foreshadowing", title: "主线伏笔",
        createdById: "u1", prisma
      });

      expect(result.threadType).toBe("foreshadowing");
    });

    it("lists open plot threads ordered by priority", async () => {
      const prisma = mockPrisma({
        plotThread: {
          findMany: vi.fn().mockResolvedValue([{ id: "pt1", status: "planted" }, { id: "pt2", status: "progressing" }])
        }
      });

      const result = await findPlotThreadsByProject("org1", "p1", prisma);

      expect(result).toHaveLength(2);
    });
  });

  describe("projectMemories", () => {
    it("creates a proposed memory", async () => {
      const pm = { id: "pm1", memoryType: "chapter_summary", content: "第一章摘要", status: "proposed" };
      const prisma = mockPrisma({ projectMemory: { create: vi.fn().mockResolvedValue(pm) } });

      const result = await createProjectMemory({
        organizationId: "org1", projectId: "p1",
        memoryType: "chapter_summary", scopeType: "chapter",
        scopeId: "c1", content: "第一章摘要",
        sourceChapterId: "c1", prisma
      });

      expect(result.status).toBe("proposed");
    });

    it("preserves zero confidence when creating a memory", async () => {
      const create = vi.fn().mockResolvedValue({ id: "pm1", confidence: 0 });
      const prisma = mockPrisma({ projectMemory: { create } });

      await createProjectMemory({
        organizationId: "org1", projectId: "p1",
        memoryType: "world_fact", scopeType: "project",
        content: "待确认事实", confidence: 0, prisma
      });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ confidence: 0 })
      }));
    });

    it("lists accepted memories of a given type", async () => {
      const prisma = mockPrisma({
        projectMemory: { findMany: vi.fn().mockResolvedValue([{ id: "pm1", status: "accepted" }]) }
      });

      const result = await findMemoriesByProject("org1", "p1", { status: "accepted" }, prisma);

      expect(result).toHaveLength(1);
    });

    it("updates rejection status using existing schema fields", async () => {
      const update = vi.fn().mockResolvedValue({ id: "pm1", status: "rejected" });
      await setMemoryStatus("org1", "pm1", "rejected", mockPrisma({ projectMemory: { update } }));
      expect(update).toHaveBeenCalledWith({where:{id:"pm1",organizationId:"org1"},data:{status:"rejected"}});
    });
  });
});

it("rejects reaccepting a source-derived superseded memory from a stale tab",async()=>{
 const update=vi.fn(),updateMany=vi.fn();const row={id:"m",organizationId:"org1",projectId:"p1",sourceChapterId:"c1",status:"superseded"};
 const tx={projectMemory:{findFirst:vi.fn().mockResolvedValue(row),update,updateMany},$queryRaw:vi.fn().mockResolvedValue([{id:"c1",projectId:"p1",content:"新正文"}])};
 const prisma={...tx,$transaction:async(cb:any)=>cb(tx)};
 await expect(setMemoryStatus("org1","m","accepted",prisma as never)).rejects.toThrow("记忆已失效");
 expect(update).not.toHaveBeenCalled();expect(updateMany).not.toHaveBeenCalled();
});

it("accepts a proposed memory without writing a nonexistent acceptedAt column",async()=>{
 const row={id:"m",organizationId:"org1",projectId:"p1",sourceChapterId:"c1",status:"proposed"};const update=vi.fn().mockResolvedValue({...row,status:"accepted"});
 const tx={projectMemory:{findFirst:vi.fn().mockResolvedValue(row),update,updateMany:vi.fn().mockResolvedValue({count:1})},$queryRaw:vi.fn().mockResolvedValue([{id:"c1",projectId:"p1",content:"正文"}])};
 await setMemoryStatus("org1","m","accepted",{...tx,$transaction:async(cb:any)=>cb(tx)}as never);
 expect(JSON.stringify(update.mock.calls)).not.toContain("acceptedAt");
 expect(tx.$queryRaw).toHaveBeenCalled();
});

it.each(["superseded","rejected"])("cannot reactivate %s memory by first proposing it again",async currentStatus=>{
 const row={id:"m",organizationId:"org1",projectId:"p1",sourceChapterId:"c1",status:currentStatus};
 const tx={projectMemory:{findFirst:vi.fn().mockResolvedValue(row),updateMany:vi.fn(),update:vi.fn()},$queryRaw:vi.fn().mockResolvedValue([{id:"c1",projectId:"p1",content:"新正文"}])};
 await expect(setMemoryStatus("org1","m","proposed",{...tx,$transaction:async(cb:any)=>cb(tx)}as never)).rejects.toThrow("记忆已失效");
 expect(tx.projectMemory.updateMany).not.toHaveBeenCalled();expect(tx.projectMemory.update).not.toHaveBeenCalled();
});