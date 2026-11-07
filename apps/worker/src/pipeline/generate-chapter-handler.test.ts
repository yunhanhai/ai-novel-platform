import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenerateChapterHandler,
  commitFinalize
} from "./generate-chapter-handler";
import type { GenerationJob } from "../poll";

const baseJob: GenerationJob = {
  id: "job-1",
  organizationId: "org-1",
  projectId: "proj-1",
  userId: "user-1",
  jobType: "GENERATE_CHAPTER",
  status: "RUNNING",
  input: {},
  targetEntityType: "CHAPTER",
  targetEntityId: "chapter-1"
};

function createTxStub(overrides: Partial<TxStub> = {}): TxStub {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{id:"chapter-1",projectId:"proj-1",content:null}]),
    projectMemory: {updateMany:vi.fn().mockResolvedValue({count:0})},
    chapter: {
      findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", projectId: "proj-1" }),
      update: vi.fn().mockResolvedValue({})
    },
    contentVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "ver-1", versionNo: 1 })
    },
    generationStep: {
      create: vi.fn().mockResolvedValue({ id: "step-finalize" }),
      update: vi.fn().mockResolvedValue({})
    },
    generationJob: {
      update: vi.fn().mockResolvedValue({})
    },
    usageEvent: {
      create: vi.fn().mockResolvedValue({ id: "usage-1" })
    },
    ...overrides
  };
}

interface TxStub {
  $queryRaw: ReturnType<typeof vi.fn>;
  projectMemory: {updateMany:ReturnType<typeof vi.fn>};
  chapter: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contentVersion: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  generationStep: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  generationJob: { update: ReturnType<typeof vi.fn> };
  usageEvent: { create: ReturnType<typeof vi.fn> };
}

interface PrismaStubOptions {
  chapterMissing?: boolean;
  txThrowsOn?: "contentVersion.create";
  enqueueThrows?: boolean;
}

function createPrismaStub(options: PrismaStubOptions = {}) {
  const tx =
    options.txThrowsOn === "contentVersion.create"
      ? createTxStub({
          contentVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockRejectedValue(new Error("commit failed"))
          }
        })
      : createTxStub();

  const outerChapter = options.chapterMissing
    ? null
    : { id: "chapter-1", projectId: "proj-1", organizationId: "org-1" };

  const prisma = {
    chapter: {
      findFirst: vi.fn().mockResolvedValue(outerChapter)
    },
    generationStep: {
      create: vi.fn().mockResolvedValue({ id: "step-x" }),
      update: vi.fn().mockResolvedValue({})
    },
    generationJob: {
      create: options.enqueueThrows
        ? vi.fn().mockRejectedValue(new Error("enqueue failed"))
        : vi.fn().mockResolvedValue({ id: "diag-job-1" }),
      update: vi.fn().mockResolvedValue({})
    },
    $transaction: vi.fn(async (cb: (tx: TxStub) => Promise<unknown>) => cb(tx))
  };
  return { prisma, tx };
}

const stubModel = {
  generate: vi.fn().mockResolvedValue({
    text: "第一章 终稿正文",
    inputTokens: 100,
    outputTokens: 50
  })
};

describe("createGenerateChapterHandler", () => {
  it("commits chapter, content version, finalize step, and job inside a single tx", async () => {
    const { prisma, tx } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "chapter-1" },
        data: expect.objectContaining({
          wordCount: expect.any(Number),
          updatedById: "user-1",
          lastGeneratedJobId: "job-1"
        })
      })
    );
    expect(tx.contentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          projectId: "proj-1",
          entityType: "CHAPTER",
          entityId: "chapter-1",
          versionNo: 1,
          source: "AI",
          generationJobId: "job-1",
          createdById: "user-1"
        })
      })
    );
    expect(tx.generationStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: "job-1",
          stepKey: "finalize",
          status: "SUCCEEDED",
          organizationId: "org-1"
        })
      })
    );
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          progress: "100",
          output: expect.objectContaining({
            chapterId: "chapter-1",
            versionId: "ver-1",
            versionNo: 1
          })
        })
      })
    );
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("writes a UsageEvent with token totals accumulated across pipeline steps", async () => {
    const { prisma, tx } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.usageEvent.create).toHaveBeenCalledTimes(1);
    const usageData = tx.usageEvent.create.mock.calls[0]![0].data;
    expect(usageData).toMatchObject({
      organizationId: "org-1",
      projectId: "proj-1",
      userId: "user-1",
      generationJobId: "job-1",
      modelName: "fake-model",
      billingSource: "PLATFORM"
    });
    // 4 个模型步骤（plan/draft/review/extract_memory），每步 100/50 token
    expect(usageData.inputTokens).toBe(400);
    expect(usageData.outputTokens).toBe(200);
  });

  it("marks job FAILED with CHAPTER_NOT_FOUND when chapter is missing", async () => {
    const { prisma, tx } = createPrismaStub({ chapterMissing: true });
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "FAILED",
        errorCode: "CHAPTER_NOT_FOUND"
      })
    );
    expect(tx.chapter.update).not.toHaveBeenCalled();
    expect(tx.contentVersion.create).not.toHaveBeenCalled();
  });

  it("rolls back the finalize tx and rethrows when contentVersion.create throws inside tx", async () => {
    const { prisma, tx } = createPrismaStub({ txThrowsOn: "contentVersion.create" });
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await expect(handler(baseJob)).rejects.toThrow("commit failed");

    expect(tx.chapter.update).toHaveBeenCalledOnce();
    expect(tx.contentVersion.create).toHaveBeenCalledOnce();
    expect(tx.generationStep.create).not.toHaveBeenCalled();
    expect(tx.generationJob.update).not.toHaveBeenCalled();

    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("prefers targetEntityId over input.chapterId when resolving chapter", async () => {
    const { prisma } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler({
      ...baseJob,
      targetEntityType: "CHAPTER",
      targetEntityId: "chapter-1",
      input: { chapterId: "should-be-ignored" }
    });

    expect(prisma.chapter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "chapter-1" })
      })
    );
  });
});

describe("methodology loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads active methodology and passes to pipeline buildContext", async () => {
    const tx = createTxStub();
    const mockWmFindFirst = vi.fn().mockResolvedValue({
      name: "雪花写作法",
      methodType: "snowflake",
      reviewCriteria: null,
      outlineMetadata: null
    });

    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", projectId: "proj-1", organizationId: "org-1" })
      },
      generationStep: {
        create: vi.fn().mockResolvedValue({ id: "step-x" }),
        update: vi.fn().mockResolvedValue({})
      },
      writingMethodology: { findFirst: mockWmFindFirst },
      $transaction: vi.fn(async (cb: (tx: TxStub) => Promise<unknown>) => cb(tx))
    };

    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    // 方法论查询被调用
    expect(mockWmFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: "proj-1", isActive: true })
      })
    );
    // handler 成功完成
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" })
      })
    );
  });

  it("completes successfully when no active methodology exists", async () => {
    const tx = createTxStub();
    // 有 writingMethodology 但查询返回 null
    const mockWmFindFirst = vi.fn().mockResolvedValue(null);

    const prisma = {
      chapter: {
        findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", projectId: "proj-1", organizationId: "org-1" })
      },
      generationStep: {
        create: vi.fn().mockResolvedValue({ id: "step-x" }),
        update: vi.fn().mockResolvedValue({})
      },
      writingMethodology: { findFirst: mockWmFindFirst },
      $transaction: vi.fn(async (cb: (tx: TxStub) => Promise<unknown>) => cb(tx))
    };

    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" })
      })
    );
  });
});

describe("model resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createPrismaForResolution() {
    const tx = createTxStub();
    return {
      prisma: {
        chapter: { findFirst: vi.fn().mockResolvedValue({ id: "chapter-1", projectId: "proj-1", organizationId: "org-1" }) },
        generationStep: {
          create: vi.fn().mockResolvedValue({ id: "step-x" }),
          update: vi.fn().mockResolvedValue({})
        },
        $transaction: vi.fn(async (cb: (tx: TxStub) => Promise<unknown>) => cb(tx))
      },
      tx
    };
  }

  it("uses resolved model when resolveModel returns an adapter", async () => {
    const { prisma, tx } = createPrismaForResolution();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const resolvedModel = {
      generate: vi.fn().mockResolvedValue({ text: "real output", inputTokens: 50, outputTokens: 30 })
    };
    const resolveModel = vi.fn(async () => resolvedModel);

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never,
      resolveModel: resolveModel as never
    });

    await handler(baseJob);

    expect(resolveModel).toHaveBeenCalledWith(baseJob);
    // resolved model was used (stubModel.generate should NOT have been called)
    expect(resolvedModel.generate).toHaveBeenCalled();
    expect(stubModel.generate).not.toHaveBeenCalled();
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" })
      })
    );
  });

  it("falls back to fake model when resolveModel returns null and useFakeModel is true", async () => {
    const { prisma, tx } = createPrismaForResolution();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const resolveModel = vi.fn(async () => null);

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never,
      resolveModel: resolveModel as never
    });

    await handler(baseJob);

    // Falls through to the injected model (stubModel)
    expect(resolveModel).toHaveBeenCalled();
    expect(stubModel.generate).toHaveBeenCalled();
    expect(tx.generationJob.update).toHaveBeenCalled();
  });

  it("marks job FAILED with NO_MODEL_PROFILE when resolveModel returns null and no fallback model", async () => {
    const { prisma } = createPrismaForResolution();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const resolveModel = vi.fn(async () => null);

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      // no model injected, and resolveModel returns null → no model at all
      resolveModel: resolveModel as never
    });

    await handler(baseJob);

    expect(resolveModel).toHaveBeenCalled();
    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "FAILED",
        errorCode: "NO_MODEL_PROFILE"
      })
    );
  });
});

describe("performance summary and deep diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes performanceSummary in the parent job output (balanced default)", async () => {
    const { prisma, tx } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          output: expect.objectContaining({
            performanceSummary: expect.objectContaining({
              qualityMode: "balanced",
              modelCalls: 4
            })
          })
        })
      })
    );
  });

  it("enqueues a DIAGNOSE_CHAPTER child job when qualityMode is deep", async () => {
    const { prisma, tx } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler({ ...baseJob, input: { qualityMode: "deep" } });

    expect(prisma.generationJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: "DIAGNOSE_CHAPTER",
          targetEntityType: "CHAPTER",
          targetEntityId: "chapter-1",
          organizationId: "org-1",
          projectId: "proj-1",
          userId: "user-1"
        })
      })
    );
    // 父任务仍在事务内标记 SUCCEEDED
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) })
    );
  });

  it("does not enqueue diagnostics for fast/balanced modes", async () => {
    const { prisma } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler({ ...baseJob, input: { qualityMode: "fast" } });

    expect(prisma.generationJob.create).not.toHaveBeenCalled();
  });

  it("keeps the parent SUCCEEDED and records diagnosticWarning when enqueue fails", async () => {
    const { prisma, tx } = createPrismaStub({ enqueueThrows: true });
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler({ ...baseJob, input: { qualityMode: "deep" } });

    // 父任务事务内已 SUCCEEDED
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) })
    );
    // 入队失败 → 事务外补写 diagnosticWarning，父任务状态不变
    expect(prisma.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({
          output: expect.objectContaining({ diagnosticWarning: expect.any(String) })
        })
      })
    );
    expect(updateJobStatus).not.toHaveBeenCalled();
  });
});

describe("commitFinalize", () => {
  it("computes nextVersionNo as max+1 when versions exist", async () => {
    const tx = createTxStub({
      contentVersion: {
        findFirst: vi.fn().mockResolvedValue({ versionNo: 4 }),
        create: vi.fn().mockResolvedValue({ id: "ver-5", versionNo: 5 })
      }
    });
    const prisma = {
      $transaction: vi.fn(async (cb: (tx: TxStub) => Promise<unknown>) => cb(tx))
    } as never;

    const out = await commitFinalize({
      prisma,
      job: baseJob,
      chapter: { id: "chapter-1", projectId: "proj-1", organizationId: "org-1" },
      finalContent: "content",
      wordCount: 7
    });

    expect(out.versionNo).toBe(5);
    expect(tx.contentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNo: 5 })
      })
    );
  });
});

describe("generation context evidence", () => {
  it("carries the stored project premise into planning and drafting", async () => {
    const { prisma } = createPrismaStub();
    const premise = "夜班失物招领员必须与保安发生利益冲突，寄件人来自明天。";
    prisma.chapter.findFirst.mockResolvedValue({
      id: "chapter-1", projectId: "proj-1", organizationId: "org-1", chapterNo: 1,
      title: "钥匙", outlineSummary: "核对寄件人", project: { title: "雨夜", styleBrief: null, premise }
    });
    const model = { generate: vi.fn().mockResolvedValue({ text: "正文", inputTokens: 10, outputTokens: 10 }) };
    await createGenerateChapterHandler({ prisma: prisma as never, updateJobStatus: vi.fn(), model })(
      { ...baseJob, input: { qualityMode: "fast", performanceBudget: { maxModelCalls: 2 } } }
    );
    expect(prisma.chapter.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ project: { select: expect.objectContaining({ premise: true }) } })
    }));
    expect(model.generate).toHaveBeenCalledTimes(2);
    for (const [prompt] of model.generate.mock.calls) expect(prompt).toContain(premise);
  });
  it("caps optional context by the input performance budget and saves a content fingerprint", async () => {
    const { prisma, tx } = createPrismaStub();
    prisma.chapter.findFirst.mockResolvedValue({
      id: "chapter-1", projectId: "proj-1", organizationId: "org-1", chapterNo: 1,
      title: "启程", outlineSummary: "出发", updatedAt: new Date("2026-11-07T00:00:00Z"),
      project: { title: "作品", styleBrief: null, updatedAt: new Date("2026-11-06T00:00:00Z") }
    });
    const character = { id: "hero", name: "主角", roleType: "protagonist", motivation: "中".repeat(3000) };
    const withAssets = { ...prisma, character: { findMany: vi.fn().mockResolvedValue([character]) } };
    const model = { generate: vi.fn().mockResolvedValue({ text: "终稿", inputTokens: 10, outputTokens: 10 }) };
    const handler = createGenerateChapterHandler({ prisma: withAssets as never, updateJobStatus: vi.fn(), model: model as never });
    await handler({ ...baseJob, input: { qualityMode: "fast", performanceBudget: { maxInputTokens: 1000 }, contextOptions: { budgetPreset: "rich" } } });

    const output = tx.generationJob.update.mock.calls[0]![0].data.output;
    expect(output.performanceSummary.contextBudget).toMatchObject({ tokenBudget: 500, includedCount: 0, trimmedCount: 1 });
    expect(output.performanceSummary.contextFingerprint).toMatchObject({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/), chapterId: "chapter-1",
      contextOptionsHash: expect.stringMatching(/^[a-f0-9]{64}$/), sourceUpdatedAt: "2026-11-07T00:00:00.000Z"
    });
    expect(model.generate.mock.calls[0]![0]).not.toContain("中".repeat(50));
    expect(withAssets.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", projectId: "proj-1" }) }));
  });

  it("loads the active methodology within the job organization", async () => {
    const { prisma } = createPrismaStub();
    const findFirst = vi.fn().mockResolvedValue(null);
    const handler = createGenerateChapterHandler({ prisma: { ...prisma, writingMethodology: { findFirst } } as never, updateJobStatus: vi.fn(), model: stubModel as never });
    await handler(baseJob);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", projectId: "proj-1" }) }));
  });
});

it("preserves generated prose and exposes failed deterministic constraints without extra calls",async()=>{
  const {prisma,tx}=createPrismaStub();
  const model={generate:vi.fn().mockResolvedValue({text:"短正文",inputTokens:3,outputTokens:3})};
  await createGenerateChapterHandler({prisma:prisma as never,updateJobStatus:vi.fn(),model})({...baseJob,input:{qualityMode:"fast",performanceBudget:{maxModelCalls:2},qualityConstraints:{minChars:700,maxChars:900,requiredFacts:["死亡预告"]}}});
  expect(model.generate).toHaveBeenCalledTimes(2);
  expect(tx.contentVersion.create.mock.calls[0]?.[0].data.content).toBe("短正文");
  expect(tx.generationJob.update.mock.calls[0]?.[0].data.output.qualitySummary).toMatchObject({passed:false,charCount:3,lengthPassed:false,missingFacts:["死亡预告"]});
});

it("finalizes useful prose and its warning after optional extraction fails", async () => {
  const { prisma, tx } = createPrismaStub();
  const model = { generate: vi.fn()
    .mockResolvedValueOnce({ text: '{"chapterGoal":"写作","sceneBeats":[],"charactersInScene":[]}', inputTokens: 10, outputTokens: 5 })
    .mockResolvedValueOnce({ text: "不应因抽取失败而消失的正文。", inputTokens: 20, outputTokens: 10 })
    .mockResolvedValueOnce({ text: '{"issues":[],"passed":true}', inputTokens: 10, outputTokens: 5 })
    .mockRejectedValueOnce(new Error("Request timed out.")) };
  await createGenerateChapterHandler({ prisma: prisma as never, updateJobStatus: vi.fn(), model })(baseJob);
  expect(tx.contentVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: "不应因抽取失败而消失的正文。" }) }));
  expect(tx.generationJob.update.mock.calls[0]?.[0].data.output.generationWarnings).toEqual([expect.objectContaining({ stepKey: "extract_memory", code: "MODEL_ERROR" })]);
});
it("persists successful pipeline memories in the same finalize transaction as the chapter",async()=>{
 const {prisma,tx}=createPrismaStub();
 const store={findMany:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue({}),updateMany:vi.fn().mockResolvedValue({count:0})};
 const dbTx={...tx,projectMemory:store,$queryRaw:vi.fn().mockResolvedValue([{id:"chapter-1",content:"有效新章。"}])};
 prisma.$transaction.mockImplementation(async cb=>cb(dbTx));
 const model={generate:vi.fn().mockResolvedValueOnce({text:'{"chapterGoal":"写作","sceneBeats":[],"charactersInScene":[]}',inputTokens:2,outputTokens:2}).mockResolvedValueOnce({text:"有效新章。",inputTokens:2,outputTokens:2}).mockResolvedValueOnce({text:'{"characterChanges":[],"worldFacts":[{"fact":"钥匙来源待查"}],"newHooks":[],"summary":"发现钥匙","chapterSummary":"钥匙来源待查。"}',inputTokens:2,outputTokens:2})};
 await createGenerateChapterHandler({prisma:prisma as never,updateJobStatus:vi.fn(),model})({...baseJob,input:{qualityMode:"fast"}});
 expect(store.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({memoryType:"chapter_summary",sourceChapterId:"chapter-1",sourceJobId:"job-1",status:"accepted"})}));
 expect(store.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({memoryType:"world_fact",status:"proposed"})}));
 expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});
it("invalidates prior source memories before saving a generated chapter",async()=>{
 const {prisma,tx}=createPrismaStub();
 const store={updateMany:vi.fn().mockResolvedValue({count:2})};
 const locked={...tx,$queryRaw:vi.fn().mockResolvedValue([{id:"chapter-1",projectId:"proj-1",content:"旧正文"}]),projectMemory:store};
 prisma.$transaction.mockImplementation(async cb=>cb(locked));
 await commitFinalize({prisma:prisma as never,job:baseJob,chapter:{id:"chapter-1",projectId:"proj-1",organizationId:"org-1"},finalContent:"新正文",wordCount:3});
 expect(store.updateMany).toHaveBeenCalledWith({where:{organizationId:"org-1",projectId:"proj-1",sourceChapterId:"chapter-1",status:{in:["proposed","accepted"]}},data:{status:"superseded"}});
});
it("queries only earlier source chapters when composing a generation prompt",async()=>{
 const {prisma}=createPrismaStub();prisma.chapter.findFirst.mockResolvedValue({id:"chapter-1",projectId:"proj-1",organizationId:"org-1",chapterNo:3,title:"第三章",outlineSummary:"核查",project:{title:"作品",premise:null,styleBrief:null}});
 const findMany=vi.fn().mockResolvedValue([]);const model={generate:vi.fn().mockResolvedValue({text:"正文",inputTokens:2,outputTokens:2})};
 await createGenerateChapterHandler({prisma:{...prisma,projectMemory:{findMany}}as never,updateJobStatus:vi.fn(),model})({...baseJob,input:{qualityMode:"fast",performanceBudget:{maxModelCalls:2}}});
 expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({OR:[{sourceChapterId:null},{sourceChapter:{is:{organizationId:"org-1",projectId:"proj-1",deletedAt:null,chapterNo:{lt:3}}}}]})}));
});

it("keeps the requested database memory excluded from actual worker plan and draft prompts", async () => {
  const { prisma } = createPrismaStub();
  prisma.chapter.findFirst.mockResolvedValue({ id: "chapter-1", projectId: "proj-1", organizationId: "org-1", chapterNo: 3, title: "调查" });
  const findMany = vi.fn().mockResolvedValue([
    { id: "memory-new", memoryType: "world_fact", content: "应保留的新线索", scopeType: "project", sourceChapterId: null },
    { id: "memory-old", memoryType: "world_fact", content: "用户明确排除的旧线索", scopeType: "project", sourceChapterId: null }
  ]);
  const model = { generate: vi.fn<(...args: unknown[]) => Promise<{ text: string; inputTokens: number; outputTokens: number }>>().mockResolvedValue({ text: "有效的新正文", inputTokens: 1, outputTokens: 1 }) };
  await createGenerateChapterHandler({ prisma: { ...prisma, projectMemory: { findMany } } as never, updateJobStatus: vi.fn(), model })({
    ...baseJob, input: { qualityMode: "fast", performanceBudget: { maxModelCalls: 2 }, contextOptions: { excludedAssetIds: ["memory:memory-old"] } }
  });
  expect(model.generate).toHaveBeenCalledTimes(2);
  for (const call of model.generate.mock.calls) {
    expect(call[0]).not.toContain("用户明确排除的旧线索");
    expect(call[0]).toContain("应保留的新线索");
  }
});
