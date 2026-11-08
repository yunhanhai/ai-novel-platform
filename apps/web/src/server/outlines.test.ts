import { describe, expect, it, vi } from "vitest";
import { createOutline, findOutlinesByProject, updateOutline, deleteOutline, getOutline, outlineRevisionHash } from "./outlines";

const outline = { id: "o1", organizationId: "org1", projectId: "p1", parentId: null, level: "BOOK", title: "全书大纲", summary: null, orderIndex: 1, status: "PLANNED", createdById: "u1" };
const hash = outlineRevisionHash(outline);
function fixture() {
  const events: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (..._args: unknown[]) => { events.push("lock-project"); return [{id: "p1"}]; }),
    outline: {
      create: vi.fn(async (args: any) => { events.push("create"); return { ...outline, ...args.data }; }),
      findFirst: vi.fn(async () => { events.push("recheck"); return outline; }),
      update: vi.fn(async (args: any) => { events.push("update"); return { ...outline, ...args.data }; }),
      delete: vi.fn(async () => { events.push("delete"); return outline; })
    }
  };
  const client = {
    outline: { findFirst: vi.fn().mockResolvedValue({projectId:"p1"}), findMany: vi.fn().mockResolvedValue([outline]), create: vi.fn().mockResolvedValue(outline), update: vi.fn().mockResolvedValue(outline), delete: vi.fn().mockResolvedValue(outline) },
    $transaction: vi.fn(async (cb: (value: typeof tx) => unknown) => cb(tx))
  };
  return { client, tx, events, prisma: client as never };
}
const create = (prisma: never, extra = {}) => createOutline({ organizationId:"org1", projectId:"p1", level:"BOOK", title:"全书大纲", orderIndex:1, createdById:"u1", prisma, ...extra });

describe("outline project write locks", () => {
  it("locks the scoped project before creating and preserves explicit empty summary", async () => {
    const f=fixture(); const result=await create(f.prisma,{summary:""});
    expect(f.events).toEqual(["lock-project","create"]); expect(result.summary).toBe("");
    expect((f.tx.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("")).toMatch(/organization_id.*deleted_at.*FOR UPDATE/s);
    expect(f.client.outline.create).not.toHaveBeenCalled();
  });
  it("validates parent within the same project after locking", async () => {
    const f=fixture(); await create(f.prisma,{parentId:"parent"});
    expect(f.events).toEqual(["lock-project","recheck","create"]);
    expect(f.tx.outline.findFirst).toHaveBeenCalledWith({where:{id:"parent",organizationId:"org1",projectId:"p1"},select:{id:true}});
  });
  it("rejects foreign/deleted project before creating", async () => {
    const f=fixture(); f.tx.$queryRaw.mockResolvedValue([]);
    await expect(create(f.prisma)).rejects.toThrow(/项目不存在/); expect(f.tx.outline.create).not.toHaveBeenCalled();
  });
  it("rejects a parent outside the project without writing", async () => {
    const f=fixture(); f.tx.outline.findFirst.mockResolvedValue(null as never);
    await expect(create(f.prisma,{parentId:"foreign"})).rejects.toThrow(/父级大纲不存在/); expect(f.tx.outline.create).not.toHaveBeenCalled();
  });
  it("reads project then locks and rechecks the node before update, including clearing summary", async () => {
    const f=fixture(); const result=await updateOutline("org1","o1",{title:"新标题",summary:""},f.prisma,hash);
    expect(f.events).toEqual(["lock-project","recheck","update"]); expect(result.summary).toBe("");
    expect(f.client.outline.findFirst).toHaveBeenCalledWith({where:{id:"o1",organizationId:"org1"},select:{projectId:true}});
    expect(f.tx.outline.findFirst).toHaveBeenCalledWith({where:{id:"o1",organizationId:"org1",projectId:"p1"}});
    expect(f.client.outline.update).not.toHaveBeenCalled();
  });
  it("rejects a node removed while awaiting the project lock", async () => {
    const f=fixture(); f.tx.outline.findFirst.mockResolvedValue(null as never);
    await expect(updateOutline("org1","o1",{title:"新"},f.prisma,hash)).rejects.toThrow(/大纲条目不存在/); expect(f.tx.outline.update).not.toHaveBeenCalled();
  });
  it("rejects an inaccessible node before acquiring a project lock", async () => {
    const f=fixture(); f.client.outline.findFirst.mockResolvedValue(null);
    await expect(updateOutline("org1","o1",{title:"新"},f.prisma,hash)).rejects.toThrow(/大纲条目不存在/); expect(f.client.$transaction).not.toHaveBeenCalled();
  });
  it("deletes only after scoped project lock and node recheck", async () => {
    const f=fixture(); await deleteOutline("org1","o1",f.prisma,hash);
    expect(f.events).toEqual(["lock-project","recheck","delete"]);
    expect(f.tx.outline.delete).toHaveBeenCalledWith({where:{id:"o1",organizationId:"org1",projectId:"p1"}});
  });
  it("rejects deleted project during update or deletion", async () => {
    for(const operation of [(p:never)=>updateOutline("org1","o1",{title:"new"},p,hash),(p:never)=>deleteOutline("org1","o1",p,hash)]) {
      const f=fixture(); f.tx.$queryRaw.mockResolvedValue([]); await expect(operation(f.prisma)).rejects.toThrow(/项目不存在/);
      expect(f.tx.outline.update).not.toHaveBeenCalled(); expect(f.tx.outline.delete).not.toHaveBeenCalled();
    }
  });
  it("keeps scoped read list ordered by index", async () => {
    const f=fixture(); expect(await findOutlinesByProject("org1","p1",f.prisma)).toEqual([{...outline,revisionHash:hash}]);
    expect(f.client.outline.findMany).toHaveBeenCalledWith({where:{organizationId:"org1",projectId:"p1",project:{organizationId:"org1",deletedAt:null}},orderBy:{orderIndex:"asc"}});
  });
});

it("rejects a stale patch without writing the locked newer node", async () => {
  const f=fixture();
  await expect((updateOutline as any)("org1","o1",{title:"older"},f.prisma,"b".repeat(64))).rejects.toThrow(/OUTLINE_REVISION_STALE/);
  expect(f.tx.outline.update).not.toHaveBeenCalled();
});
it("rejects stale deletion without touching the locked newer node", async () => {
  const f=fixture();
  await expect((deleteOutline as any)("org1","o1",f.prisma,"b".repeat(64))).rejects.toThrow(/OUTLINE_REVISION_STALE/);
  expect(f.tx.outline.delete).not.toHaveBeenCalled();
});
it("acknowledges same target with an old base without a write", async () => {
  const f=fixture();
  const result=await(updateOutline as any)("org1","o1",{title:outline.title},f.prisma,"b".repeat(64));
  expect(result.title).toBe(outline.title);expect(f.tx.outline.update).not.toHaveBeenCalled();
});
it("requires a valid base before any mutation", async () => {
  const f=fixture();
  await expect((updateOutline as any)("org1","o1",{title:"x"},f.prisma)).rejects.toThrow(/baseRevisionHash/);
  await expect((deleteOutline as any)("org1","o1",f.prisma,"bad")).rejects.toThrow(/baseRevisionHash/);
  expect(f.client.$transaction).not.toHaveBeenCalled();
});

it("returns scoped single reads with a revision and hides deleted projects", async()=>{
 const f=fixture(); f.client.outline.findFirst.mockResolvedValueOnce(outline);
 expect(await getOutline("org1","o1",f.prisma)).toEqual({...outline,revisionHash:hash});
 expect(f.client.outline.findFirst).toHaveBeenCalledWith({where:{id:"o1",organizationId:"org1",project:{organizationId:"org1",deletedAt:null}}});
 f.client.outline.findFirst.mockResolvedValueOnce(null);expect(await getOutline("org1","o1",f.prisma)).toBeNull();
});
it("accepts uppercase current base and returns committed-state revision",async()=>{
 const f=fixture();const result=await updateOutline("org1","o1",{summary:"新摘要"},f.prisma,hash.toUpperCase());
 expect(result.revisionHash).toBe(outlineRevisionHash({...outline,summary:"新摘要"}));expect(f.tx.outline.update).toHaveBeenCalledOnce();
});
