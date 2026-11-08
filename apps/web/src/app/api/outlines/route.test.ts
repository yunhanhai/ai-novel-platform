import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@ai-novel/db", () => ({ prisma: {} }));
vi.mock("../../../server/context", () => ({ getOrganizationId: async () => "org-1", getUserId: async () => "user-1", isUnauthorizedError: () => false }));
vi.mock("../../../server/outlines", () => ({ createOutline: vi.fn(), findOutlinesByProject: vi.fn() }));
import { GET, POST } from "./route";
import { createOutline, findOutlinesByProject } from "../../../server/outlines";
const fp = vi.mocked(findOutlinesByProject), co = vi.mocked(createOutline);
const valid = { projectId:"project", level:"CHAPTER",title:"第一章",summary:"",orderIndex:0 };
function request(body:unknown, raw=false) { return new Request("http://localhost/api/outlines",{method:"POST",body:raw?body as string:JSON.stringify(body)}); }
beforeEach(()=>vi.clearAllMocks());
describe("outlines API",()=>{
 it("GET requires project",async()=>{expect((await GET(new Request("http://localhost/api/outlines"))).status).toBe(400)});
 it("GET returns scoped list",async()=>{fp.mockResolvedValue([]);expect((await GET(new Request("http://localhost/api/outlines?projectId=proj-1"))).status).toBe(200)});
 it.each([null,[],"text",{}, {...valid,title:4},{...valid,title:" "},{...valid,title:"x".repeat(201)},{...valid,summary:3},{...valid,orderIndex:-1},{...valid,orderIndex:1.2},{...valid,level:"wrong"},{...valid,parentId:[]},{...valid,projectId:2}])("rejects invalid create %j",async body=>{expect((await POST(request(body))).status).toBe(400);expect(co).not.toHaveBeenCalled()});
 it("rejects malformed JSON",async()=>{expect((await POST(request("{",true))).status).toBe(400)});
 it("creates trimmed title and preserves empty summary",async()=>{co.mockResolvedValue({id:"o1"}as never);expect((await POST(request({...valid,title:"  第一章  "}))).status).toBe(201);expect(co).toHaveBeenCalledWith(expect.objectContaining({organizationId:"org-1",title:"第一章",summary:"",createdById:"user-1"}))});
 it("returns404 for unavailable project or parent",async()=>{co.mockRejectedValue(new Error("父级大纲不存在或不属于当前项目"));expect((await POST(request(valid))).status).toBe(404)});
});
