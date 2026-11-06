import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({session:vi.fn(),logs:vi.fn()}));
vi.mock("@ai-novel/db",()=>({prisma:{}}));
vi.mock("../../../../server/context",()=>({requireSession:mocks.session,isUnauthorizedError:(e:Error)=>e.name==="UnauthorizedError"}));
vi.mock("../../../../server/recovery-audit",async(original)=>({...await original<typeof import("../../../../server/recovery-audit")>(),getRecoveryAuditLogs:mocks.logs}));
import {GET} from "./route";
import {prisma} from "@ai-novel/db";
describe("session-scoped recovery audit",()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({organizationId:"org-session",userId:"user-1"});mocks.logs.mockResolvedValue({items:[],total:0});});
 it("scopes logs to asynchronous session identity",async()=>{expect((await GET(new Request("http://localhost/api/audit-logs/recovery-actions?limit=20"))).status).toBe(200);expect(mocks.logs).toHaveBeenCalledWith({prisma,organizationId:"org-session",limit:20});});
 it("returns 401 for expired sessions",async()=>{mocks.session.mockRejectedValue(Object.assign(new Error("expired"),{name:"UnauthorizedError"}));expect((await GET(new Request("http://localhost"))).status).toBe(401);expect(mocks.logs).not.toHaveBeenCalled();});
 it("rejects invalid limits",async()=>{expect((await GET(new Request("http://localhost?limit=abc"))).status).toBe(400);expect(mocks.logs).not.toHaveBeenCalled();});
 it("hides DB errors",async()=>{mocks.logs.mockRejectedValue(new Error("postgres:password"));const response=await GET(new Request("http://localhost"));expect(response.status).toBe(500);expect((await response.json()).error).toBe("服务器内部错误");});
});