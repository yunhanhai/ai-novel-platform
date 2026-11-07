import{describe,expect,it,vi}from"vitest";
import{lockMemorySourceChapter,supersedeChapterMemories,activeMemorySourceFilter}from"./chapter-memory";

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