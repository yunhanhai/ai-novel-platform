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
    ...overrides
  };
}

interface TxStub {
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
}

interface PrismaStubOptions {
  chapterMissing?: boolean;
  txThrowsOn?: "contentVersion.create";
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
      create: vi.fn().mockResolvedValue({ id: "diag-1" }),
      update: vi.fn().mockResolvedValue({})
    },
    usageEvent: {
      create: vi.fn().mockResolvedValue({})
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
            versionNo: 1,
            performanceSummary: expect.objectContaining({
              qualityMode: "balanced"
            })
          })
        })
      })
    );
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("enqueues a diagnostic job after deep generation succeeds", async () => {
    const { prisma } = createPrismaStub();
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler({
      ...baseJob,
      input: { qualityMode: "deep" }
    });

    expect(prisma.generationJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: "DIAGNOSE_CHAPTER",
          targetEntityType: "CHAPTER",
          targetEntityId: "chapter-1",
          input: expect.objectContaining({
            chapterId: "chapter-1",
            parentJobId: "job-1"
          })
        })
      })
    );
  });

  it("keeps parent succeeded when deep diagnostic enqueue fails", async () => {
    const { prisma, tx } = createPrismaStub();
    prisma.generationJob.create.mockRejectedValue(new Error("queue unavailable"));
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler({
      ...baseJob,
      input: { qualityMode: "deep" }
    });

    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" })
      })
    );
    expect(prisma.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({
          output: expect.objectContaining({
            diagnosticWarning: expect.stringContaining("queue unavailable")
          })
        })
      })
    );
    expect(updateJobStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" })
    );
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

  it("rolls back and marks FINALIZE_FAILED when contentVersion.create throws inside tx", async () => {
    const { prisma, tx } = createPrismaStub({ txThrowsOn: "contentVersion.create" });
    const updateJobStatus = vi.fn().mockResolvedValue({});

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never
    });

    await handler(baseJob);

    expect(tx.chapter.update).toHaveBeenCalledOnce();
    expect(tx.contentVersion.create).toHaveBeenCalledOnce();
    expect(tx.generationStep.create).not.toHaveBeenCalled();
    expect(tx.generationJob.update).not.toHaveBeenCalled();

    expect(updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "FAILED",
        errorCode: "FINALIZE_FAILED",
        errorMessage: expect.stringContaining("commit failed")
      })
    );
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
        usageEvent: {
          create: vi.fn().mockResolvedValue({})
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

  it("records usage events for resolved real model calls", async () => {
    const { prisma } = createPrismaForResolution();
    const updateJobStatus = vi.fn().mockResolvedValue({});
    const resolvedModel = {
      usage: {
        providerId: "provider-1",
        modelName: "gpt-test",
        billingSource: "USER_KEY" as const
      },
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

    expect(prisma.usageEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          userId: "user-1",
          projectId: "proj-1",
          generationJobId: "job-1",
          providerId: "provider-1",
          modelName: "gpt-test",
          billingSource: "USER_KEY",
          inputTokens: 50,
          outputTokens: 30,
          latencyMs: expect.any(Number)
        })
      })
    );
  });

  it("builds generation context from project assets using the performance budget", async () => {
    const { prisma, tx } = createPrismaForResolution();
    const projectFindFirst = vi.fn().mockResolvedValue({
      id: "proj-1",
      title: "星河项目",
      styleBrief: "冷峻克制"
    });
    const characterFindMany = vi.fn().mockResolvedValue([
      {
        id: "char-1",
        name: "林澈",
        roleType: "protagonist",
        personality: "冷静",
        speechPattern: "短句",
        motivation: "找到星门",
        arc: "从逃避到承担",
        constraints: "不能暴露身份"
      }
    ]);
    Object.assign(prisma, {
      project: { findFirst: projectFindFirst },
      character: { findMany: characterFindMany },
      worldItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "world-1",
            name: "星门",
            itemType: "artifact",
            summary: "远古传送装置",
            detail: "需要三枚钥匙启动",
            constraints: "每次开启都会留下能量痕迹",
            activationKeywords: ["星门"]
          }
        ])
      },
      plotThread: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "thread-1",
            threadType: "mystery",
            title: "星门来源",
            description: "制造者身份未知",
            status: "progressing"
          }
        ])
      },
      projectMemory: {
        findMany: vi.fn().mockResolvedValue([
          {
            memoryType: "chapter_summary",
            content: "上一章发现星门坐标",
            scopeType: "chapter",
            sourceChapterId: "chapter-0"
          }
        ])
      },
      styleProfile: {
        findFirst: vi.fn().mockResolvedValue({
          styleBrief: "多用动作句",
          bannedWords: ["仿佛"],
          preferredWords: ["寒光"],
          sentenceLengthProfile: { avg: 12, min: 6, max: 24 }
        })
      }
    });

    const updateJobStatus = vi.fn().mockResolvedValue({});
    const resolvedModel = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: '{"chapterGoal":"开启星门","sceneBeats":[],"charactersInScene":["林澈"]}', inputTokens: 50, outputTokens: 20 })
        .mockResolvedValueOnce({ text: "林澈按下钥匙，星门亮起。", inputTokens: 60, outputTokens: 30 })
        .mockResolvedValueOnce({ text: '{"characterChanges":[],"worldFacts":[],"newHooks":[],"summary":"ok","chapterSummary":"ok"}', inputTokens: 30, outputTokens: 10 })
    };
    const resolveModel = vi.fn(async () => resolvedModel);

    const handler = createGenerateChapterHandler({
      prisma: prisma as never,
      updateJobStatus,
      model: stubModel as never,
      resolveModel: resolveModel as never
    });

    await handler({
      ...baseJob,
      input: {
        qualityMode: "fast",
        performanceBudget: { maxInputTokens: 6000 }
      }
    });

    expect(projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "proj-1", organizationId: "org-1" })
      })
    );
    expect(characterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: "proj-1", organizationId: "org-1", status: "active" })
      })
    );
    const firstPrompt = resolvedModel.generate.mock.calls[0]?.[0] as string;
    expect(firstPrompt).toContain("星河项目");
    expect(firstPrompt).toContain("林澈");
    expect(firstPrompt).toContain("星门");
    expect(firstPrompt).not.toContain("章节生成上下文");
    expect(tx.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          output: expect.objectContaining({
            performanceSummary: expect.objectContaining({
              contextBudget: expect.objectContaining({
                tokenBudget: expect.any(Number),
                trimmedCount: expect.any(Number)
              }),
              contextFingerprint: expect.objectContaining({
                hash: expect.stringMatching(/^[a-f0-9]{64}$/),
                chapterId: "chapter-1",
                contextOptionsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                sourceUpdatedAt: expect.any(String)
              })
            })
          })
        })
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
