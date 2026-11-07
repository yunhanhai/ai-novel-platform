import{describe,expect,it,vi}from"vitest";
import{lockMemorySourceChapter,supersedeChapterMemories,activeMemorySourceFilter,findGenerationMemories}from"./chapter-memory";

describe("source chapter memory freshness",()=>{
 it("locks an existing scoped chapter using bound SQL values",async()=>{
  const row={id:"chapter",projectId:"project",content:"body"};const query=vi.fn().mockResolvedValue([row]);
  expect(await lockMemorySourceChapter({tx:{$queryRaw:query}as never,organizationId:"org",projectId:"project",chapterId:"chapter"})).toBe(row);
  const parts=query.mock.calls[0]!;expect(parts.slice(1)).toEqual(["chapter","org","project","project"]);expect(parts[0].join("")).toContain("FOR UPDATE");
 });
 it("fails before memory mutation when source is missing or outside scope",async()=>{
  await expect(lockMemorySourceChapter({tx:{$queryRaw:vi.fn().mockResolvedValue([])}as never,organizationId:"org",chapterId:"foreign"})).rejects.toThrow("章节不存在");
 });
 it("only supersedes active source-derived memories within the tenant project",async()=>{
  const updateMany=vi.fn().mockResolvedValue({count:2});await supersedeChapterMemories({tx:{projectMemory:{updateMany}}as never,organizationId:"org",projectId:"p",chapterId:"c"});
  expect(updateMany).toHaveBeenCalledWith({where:{organizationId:"org",projectId:"p",sourceChapterId:"c",status:{in:["proposed","accepted"]}},data:{status:"superseded"}});
 });
 it("keeps source-less project memory and rejects invalid chapter sources",()=>{
  expect(activeMemorySourceFilter("org","p")).toEqual({OR:[{sourceChapterId:null},{sourceChapter:{is:{organizationId:"org",projectId:"p",deletedAt:null}}}]});
 });
});
it("bounds source chapter memories strictly before the current chapter",()=>{
 expect(activeMemorySourceFilter("org","p",3)).toEqual({OR:[{sourceChapterId:null},{sourceChapter:{is:{organizationId:"org",projectId:"p",deletedAt:null,chapterNo:{lt:3}}}}]});
});

describe("generation memory retrieval", () => {
  it("reserves nearest distinct chapter summaries then fills remaining slots", async () => {
    const near = { id: "near", sourceChapterId: "chapter-29", content: "邻章摘要" };
    const fresh = { id: "fresh", sourceChapterId: null, content: "人工事实" };
    const findMany = vi.fn().mockResolvedValueOnce([near]).mockResolvedValueOnce([fresh]);
    const result = await findGenerationMemories({ organizationId: "org", projectId: "p", beforeChapterNo: 30, prisma: { projectMemory: { findMany } } as never });
    expect(result.map(m => m.id)).toEqual(["near", "fresh"]);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { organizationId: "org", projectId: "p", status: "accepted", memoryType: "chapter_summary", sourceChapterId: { not: null }, sourceChapter: { is: { organizationId: "org", projectId: "p", deletedAt: null, chapterNo: { lt: 30 } } } }, distinct: ["sourceChapterId"], take: 5 });
    expect(findMany.mock.calls[0]?.[0].orderBy).toEqual([{ sourceChapter: { chapterNo: "desc" } }, { createdAt: "desc" }, { id: "desc" }]);
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({ where: { AND: [{ OR: [{ sourceChapterId: null }, { memoryType: { not: "chapter_summary" } }, { sourceChapterId: { notIn: ["chapter-29"] } }] }], id: { notIn: ["near"] }, status: "accepted", OR: [{ sourceChapterId: null }, { sourceChapter: { is: { organizationId: "org", projectId: "p", deletedAt: null, chapterNo: { lt: 30 } } } }] }, take: 19, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  });
  it("allows all twenty slots for ordinary memory when no prior summary exists", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) => ({ id: `manual-${i}` })));
    const result = await findGenerationMemories({ organizationId: "org", projectId: "p", beforeChapterNo: 1, prisma: { projectMemory: { findMany } } as never });
    expect(result).toHaveLength(20);
    expect(findMany.mock.calls[1]?.[0].take).toBe(20);
  });
});

it("keeps the total candidate count at twenty with all five reserved slots", async () => {
  const recent = Array.from({ length: 5 }, (_, i) => ({ id: `summary-${i}`, sourceChapterId: `chapter-${i}` }));
  const remaining = Array.from({ length: 15 }, (_, i) => ({ id: `fact-${i}`, sourceChapterId: null }));
  const findMany = vi.fn().mockResolvedValueOnce(recent).mockResolvedValueOnce(remaining);
  const result = await findGenerationMemories({ organizationId: "org", projectId: "p", beforeChapterNo: 30, prisma: { projectMemory: { findMany } } as never });
  expect(result).toHaveLength(20);
  expect(result.slice(0, 5)).toEqual(recent);
  expect(findMany.mock.calls[1]?.[0].take).toBe(15);
});
