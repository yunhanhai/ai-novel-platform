import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db",()=>({prisma:{}}));
vi.mock("../../../../server/context",()=>({getOrganizationId:async()=>"org1",isUnauthorizedError:()=>false}));
vi.mock("../../../../server/outlines",()=>({updateOutline:vi.fn(),deleteOutline:vi.fn(),getOutline:vi.fn()}));
import {GET,PATCH,DELETE} from "./route";
import {getOutline,updateOutline,deleteOutline} from "../../../../server/outlines";
const update=vi.mocked(updateOutline),remove=vi.mocked(deleteOutline);
const hash="a".repeat(64);
const context={params:Promise.resolve({id:"o1"})};
function request(value:unknown,raw=false){return new Request("http://localhost/api/outlines/o1",{method:"PATCH",body:raw?value as string:JSON.stringify(value)})}
beforeEach(()=>vi.clearAllMocks());
describe("outline item API",()=>{
 it.each([null,[],"text",{title:2},{title:" "},{title:"x".repeat(201)},{summary:2},{status:"wrong"},{projectId:"other"},{orderIndex:2},{title:"ok",unknown:true}])("rejects invalid patch %j",async value=>{expect((await PATCH(request(value),context)).status).toBe(400);expect(update).not.toHaveBeenCalled()});
 it("rejects malformed JSON",async()=>{expect((await PATCH(request("{",true),context)).status).toBe(400)});
 it("preserves explicit empty summary and trims title",async()=>{update.mockResolvedValue({id:"o1"}as never);expect((await PATCH(request({title:" 标题 ",summary:"",baseRevisionHash:hash}),context)).status).toBe(200);expect(update).toHaveBeenCalledWith("org1","o1",{title:"标题",summary:""},expect.anything(),hash)});
 it("returns404 after removed node or inaccessible project",async()=>{update.mockRejectedValue(new Error("项目不存在或不属于当前组织"));expect((await PATCH(request({title:"新",baseRevisionHash:hash}),context)).status).toBe(404)});
 it("delegates deletion to the locked helper",async()=>{remove.mockResolvedValue({id:"o1"}as never);expect((await DELETE(new Request("http://localhost/api/outlines/o1",{method:"DELETE",body:JSON.stringify({baseRevisionHash:hash})}),context)).status).toBe(200);expect(remove).toHaveBeenCalledWith("org1","o1",expect.anything(),hash)});
});

it.each([{}, {title:"new"}, {title:"new",baseRevisionHash:"bad"}])("requires a revision hash on PATCH %j", async value=>{
 expect((await PATCH(request(value),context)).status).toBe(400); expect(update).not.toHaveBeenCalled();
});
it("rejects DELETE without source hash", async()=>{
 expect((await DELETE(new Request("http://localhost/api/outlines/o1",{method:"DELETE"}),context)).status).toBe(400);expect(remove).not.toHaveBeenCalled();
});
it("maps stale updates to 409", async()=>{
 update.mockRejectedValueOnce(new Error("OUTLINE_REVISION_STALE"));
 expect((await PATCH(request({title:"new",baseRevisionHash:hash}),context)).status).toBe(409);
});
it("returns a scoped outline read with its hash",async()=>{
 vi.mocked(getOutline).mockResolvedValueOnce({id:"o1",revisionHash:hash}as never);
 const res=await GET(new Request("http://localhost/api/outlines/o1"),context);expect(res.status).toBe(200);expect((await res.json()).data.revisionHash).toBe(hash);
});
it("returns404 when the read node is unavailable",async()=>{
 vi.mocked(getOutline).mockResolvedValueOnce(null);
 expect((await GET(new Request("http://localhost/api/outlines/o1"),context)).status).toBe(404);
});
it("maps stale deletion to409 without a successful delete acknowledgment",async()=>{
 remove.mockRejectedValueOnce(new Error("OUTLINE_REVISION_STALE"));
 const response=await DELETE(new Request("http://localhost/api/outlines/o1",{method:"DELETE",body:JSON.stringify({baseRevisionHash:hash})}),context);
 expect(response.status).toBe(409);expect((await response.json()).error).toContain("未执行本次操作");
});
