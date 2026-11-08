import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db",()=>({prisma:{}}));
vi.mock("../../../../server/context",()=>({getOrganizationId:async()=>"org1",isUnauthorizedError:()=>false}));
vi.mock("../../../../server/outlines",()=>({updateOutline:vi.fn(),deleteOutline:vi.fn()}));
import {PATCH,DELETE} from "./route";
import {updateOutline,deleteOutline} from "../../../../server/outlines";
const update=vi.mocked(updateOutline),remove=vi.mocked(deleteOutline);
const context={params:Promise.resolve({id:"o1"})};
function request(value:unknown,raw=false){return new Request("http://localhost/api/outlines/o1",{method:"PATCH",body:raw?value as string:JSON.stringify(value)})}
beforeEach(()=>vi.clearAllMocks());
describe("outline item API",()=>{
 it.each([null,[],"text",{title:2},{title:" "},{title:"x".repeat(201)},{summary:2},{status:"wrong"},{projectId:"other"},{orderIndex:2},{title:"ok",unknown:true}])("rejects invalid patch %j",async value=>{expect((await PATCH(request(value),context)).status).toBe(400);expect(update).not.toHaveBeenCalled()});
 it("rejects malformed JSON",async()=>{expect((await PATCH(request("{",true),context)).status).toBe(400)});
 it("preserves explicit empty summary and trims title",async()=>{update.mockResolvedValue({id:"o1"}as never);expect((await PATCH(request({title:" 标题 ",summary:""}),context)).status).toBe(200);expect(update).toHaveBeenCalledWith("org1","o1",{title:"标题",summary:""},expect.anything())});
 it("returns404 after removed node or inaccessible project",async()=>{update.mockRejectedValue(new Error("项目不存在或不属于当前组织"));expect((await PATCH(request({title:"新"}),context)).status).toBe(404)});
 it("delegates deletion to the locked helper",async()=>{remove.mockResolvedValue({id:"o1"}as never);expect((await DELETE(new Request("http://localhost/api/outlines/o1",{method:"DELETE"}),context)).status).toBe(200);expect(remove).toHaveBeenCalledWith("org1","o1",expect.anything())});
});
