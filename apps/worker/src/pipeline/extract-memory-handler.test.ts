import { describe, expect, it, vi } from "vitest";
import { createExtractMemoryHandler } from "./extract-memory-handler";
import type { GenerationJob } from "../poll";

const baseJob: GenerationJob = {
  id: "job-1", organizationId: "org-1", projectId: "proj-1", userId: "user-1",
  jobType: "EXTRACT_MEMORY", status: "RUNNING", input: {},
  targetEntityType: "CHAPTER", targetEntityId: "chapter-1"
};

const stubModel = {
  generate: vi.fn().mockResolvedValue({
    text: '{"characterChanges":[{"characterName":"主角","change":"觉醒了新能力"}],"worldFacts":[{"fact":"这个世界有九层"}],"newHooks":[{"hook":"神秘人暗中观察"}],"summary":"主角觉醒","chapterSummary":"主角在危急时刻觉醒了新能力，同时神秘人暗中观察"}',
    inputTokens: 100, outputTokens: 80
  })
};

describe("createExtractMemoryHandler", () => {
  it("extracts memories and saves as proposed", async () => {
    interface TxStub {
      projectMemory: {
        create: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
      };
      generationStep: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
      $queryRaw: ReturnType<typeof vi.fn>;
      generationJob: { update: ReturnType<typeof vi.fn> };
    }
    const tx: TxStub = {
      projectMemory: {
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      generationStep: { create: vi.fn().mockResolvedValue({ id: "step-1" }), update: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{id:"chapter-1",content:"正文",title:"章",chapterNo:1}]),
      generationJob: { update: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({
          id: "chapter-1", content: "正文", title: "测试", chapterNo: 1
        })
      },
      generationStep: tx.generationStep,
      $transaction: vi.fn(async (cb: (t: TxStub) => Promise<unknown>) => cb(tx))
    };
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus, model: stubModel as never
    });

    await handler(baseJob);

    // 至少创建了一条 chapter_summary 记忆
    expect(tx.projectMemory.create).toHaveBeenCalled();
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" })
      })
    );
  });

  it("fails when chapter has no content", async () => {
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", content: null, title: "空" })
      }
    };
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus, model: stubModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "CHAPTER_NOT_FOUND" })
    );
  });

  it("writes the chapter summary as accepted and supersedes older states", async () => {
    const tx = {
      projectMemory: {
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ content: "旧记忆" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      generationStep: { create: vi.fn().mockResolvedValue({ id: "step-1" }), update: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{id:"chapter-1",content:"正文",title:"章",chapterNo:1}]),
      generationJob: { update: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", content: "正文", title: "章", chapterNo: 1 })
      },
      generationStep: tx.generationStep,
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
    };

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus: vi.fn().mockResolvedValue({}), model: stubModel as never
    });

    await handler(baseJob);

    // 章节摘要直接写为 accepted（生成上下文只读 accepted，堆在 proposed 里等于没有）
    const created = tx.projectMemory.create.mock.calls.map((call) => call[0] as { data: Record<string, unknown> });
    const summaryCreate = created.find((c) => c.data.memoryType === "chapter_summary");
    expect(summaryCreate).toBeDefined();
    expect(summaryCreate!.data.status).toBe("accepted");

    // 同章旧摘要被淘汰
    expect(tx.projectMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ memoryType: "chapter_summary", scopeId: "chapter-1" }),
        data: { status: "superseded" }
      })
    );

    // 写入主角新状态前，淘汰主角的更早状态
    expect(tx.projectMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memoryType: "character_state",
          content: { startsWith: "主角: " }
        }),
        data: { status: "superseded" }
      })
    );
  });

  it("skips creating a memory whose content already exists", async () => {
    const tx = {
      projectMemory: {
        create: vi.fn().mockResolvedValue({}),
        // 与模型输出完全相同的世界事实 → 应被去重跳过
        findMany: vi.fn().mockResolvedValue([{ content: "这个世界有九层" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      generationStep: { create: vi.fn().mockResolvedValue({ id: "step-1" }), update: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{id:"chapter-1",content:"正文",title:"章",chapterNo:1}]),
      generationJob: { update: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", content: "正文", title: "章", chapterNo: 1 })
      },
      generationStep: tx.generationStep,
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
    };

    const handler = createExtractMemoryHandler({
      prisma: prisma as never, updateJobStatus: vi.fn().mockResolvedValue({}), model: stubModel as never
    });

    await handler(baseJob);

    const worldFactCreates = tx.projectMemory.create.mock.calls
      .map((call) => call[0] as { data: Record<string, unknown> })
      .filter((c) => c.data.memoryType === "world_fact");
    expect(worldFactCreates).toHaveLength(0);
  });
});

function extractionFixture(text:string,content="许宁发现钥匙，但来源待查。"){
 const tx={$queryRaw:vi.fn().mockResolvedValue([{id:"chapter-1",content,title:"验收",chapterNo:1}]),projectMemory:{findMany:vi.fn().mockResolvedValue([]),updateMany:vi.fn().mockResolvedValue({count:0}),create:vi.fn().mockResolvedValue({})},generationStep:{create:vi.fn().mockResolvedValue({id:"step-1"}),update:vi.fn().mockResolvedValue({})},generationJob:{update:vi.fn().mockResolvedValue({})}};
 const prisma={chapter:{findFirst:vi.fn().mockResolvedValue({id:"chapter-1",content,title:"验收",chapterNo:1})},generationStep:tx.generationStep,usageEvent:{create:vi.fn().mockResolvedValue({})},$transaction:vi.fn(async(cb:(t:typeof tx)=>Promise<unknown>)=>cb(tx))};
 const model={generate:vi.fn().mockResolvedValue({text,inputTokens:20,outputTokens:10})};
 const updateJobStatus=vi.fn();
 return {tx,prisma,model,updateJobStatus,handler:createExtractMemoryHandler({prisma:prisma as never,model,updateJobStatus})};
}
const validExtractText=JSON.stringify({characterChanges:[],worldFacts:[{fact:"来源待查"},{fact:"来源待查"}],newHooks:[],summary:"发现钥匙",chapterSummary:"许宁发现钥匙，但来源待查。"});

it.each(["not json","{}",'{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"ok","chapterSummary":42}'])("rejects invalid standalone extraction without altering memories: %s",async text=>{
 const f=extractionFixture(text);
 await f.handler(baseJob);
 expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({status:"FAILED",errorCode:"INVALID_MODEL_OUTPUT"}));
 expect(f.tx.projectMemory.create).not.toHaveBeenCalled();
 expect(f.tx.projectMemory.updateMany).not.toHaveBeenCalled();
});

it("requests JSON, preserves uncertain facts, and records a measured extraction step",async()=>{
 const f=extractionFixture(validExtractText);
 await f.handler(baseJob);
 expect(f.model.generate).toHaveBeenCalledWith(expect.stringContaining("推测"),expect.objectContaining({responseFormat:"json_object"}));
 expect(f.prisma.generationStep.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"RUNNING",promptSnapshot:expect.any(String)})}));
 expect(f.prisma.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"SUCCEEDED",latencyMs:expect.any(Number)})}));
});

it("deduplicates repeated facts within one model response",async()=>{
 const f=extractionFixture(validExtractText);await f.handler(baseJob);
 const facts=f.tx.projectMemory.create.mock.calls.filter(c=>c[0]?.data.memoryType==="world_fact");
 expect(facts).toHaveLength(1);
});

it("does not suppress a fresh fact merely because an older copy was superseded",async()=>{
 const f=extractionFixture(validExtractText);f.tx.projectMemory.findMany.mockImplementation(async(args:any)=>args.where.status?[]:[{content:"来源待查",status:"superseded"}]);await f.handler(baseJob);
 expect(f.tx.projectMemory.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({status:{in:["proposed","accepted"]}})}));
 expect(f.tx.projectMemory.create.mock.calls.filter(c=>c[0]?.data.memoryType==="world_fact")).toHaveLength(1);
});
it("rejects stale source prose before superseding accepted memories",async()=>{
 const f=extractionFixture(validExtractText);
 (f.tx as any).$queryRaw=vi.fn().mockResolvedValue([{id:"chapter-1",content:"作者已经改过正文。"}]);
 await expect(f.handler(baseJob)).rejects.toThrow("MEMORY_SOURCE_CHANGED");
 expect(f.tx.projectMemory.updateMany).not.toHaveBeenCalled();
 expect(f.tx.projectMemory.create).not.toHaveBeenCalled();
});
it("closes the extraction step while preserving provider error identity",async()=>{
 const f=extractionFixture(validExtractText);const failure=Object.assign(new Error("Unauthorized"),{status:401});f.model.generate.mockRejectedValueOnce(failure);
 await expect(f.handler(baseJob)).rejects.toBe(failure);
 expect(f.prisma.generationStep.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"FAILED",finishedAt:expect.any(Date)})}));
 expect(f.tx.projectMemory.create).not.toHaveBeenCalled();
});

it("rolls back memory maintenance if the final job status write fails",async()=>{
 const f=extractionFixture(validExtractText);const failure=new Error("finalize database failure");f.tx.generationJob.update.mockRejectedValueOnce(failure);
 await expect(f.handler(baseJob)).rejects.toBe(failure);
 expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
 expect(f.prisma.generationStep.update).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:"FAILED"})}));
});
it("rejects empty summary fields instead of reporting an empty extraction as success",async()=>{
 const f=extractionFixture(JSON.stringify({characterChanges:[],worldFacts:[],newHooks:[],summary:"   ",chapterSummary:""}));await f.handler(baseJob);
 expect(f.updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({status:"FAILED",errorCode:"INVALID_MODEL_OUTPUT"}));
 expect(f.tx.projectMemory.create).not.toHaveBeenCalled();
});

it("preserves model authentication failure if best-effort step cleanup also fails",async()=>{
 const f=extractionFixture(validExtractText);const denied=Object.assign(new Error("Unauthorized"),{status:401});f.model.generate.mockRejectedValueOnce(denied);f.prisma.generationStep.update.mockRejectedValueOnce(new Error("cleanup database failure"));
 await expect(f.handler(baseJob)).rejects.toBe(denied);
});