import type { PrismaClient } from "@ai-novel/db";
import type { GenerationJob, JobHandler, UpdateStatusFn } from "./poll";
import type { RuntimeModel } from "./model-runtime";
import { createGenerateChapterHandler } from "./pipeline/generate-chapter-handler";
import { createDeslopHandler } from "./pipeline/deslop-handler";
import { createExtractMemoryHandler } from "./pipeline/extract-memory-handler";
import { createRewritePolishHandler } from "./pipeline/rewrite-polish-handler";
import { createContinueChapterHandler } from "./pipeline/continue-chapter-handler";
import { createBatchContinueHandler } from "./pipeline/batch-continue-handler";
import { createReviewHandler } from "./pipeline/review-handler";
import { createGenerateOutlineHandler } from "./pipeline/generate-outline-handler";
import { createDiagnoseChapterHandler, type DiagnosticType } from "./pipeline/diagnose-chapter-handler";
import { createFakeModel } from "./pipeline/fake-model";

type ResolveModel = (job: GenerationJob) => Promise<RuntimeModel | null>;

export interface HandlerFactoryDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  resolveModel?: ResolveModel;
  useFakeModel: boolean;
}

const DIAGNOSTIC_JOB_TYPES: DiagnosticType[] = [
  "DIAGNOSE_CHAPTER",
  "READER_SIMULATION",
  "STYLE_DRIFT_CHECK",
  "CONTINUITY_CHECK"
];

// 构建 jobType → handler 的注册表。诊断类共用同一个 handler 工厂，仅以 diagnosticType 区分提示词侧重。
export function createHandlers(deps: HandlerFactoryDeps): Map<string, JobHandler> {
  const { prisma, updateJobStatus, resolveModel, useFakeModel } = deps;
  const fakeModelDep = (): { model?: ReturnType<typeof createFakeModel> } =>
    useFakeModel ? { model: createFakeModel() } : {};
  const shared = { prisma, updateJobStatus, resolveModel };

  const handlers = new Map<string, JobHandler>([
    ["GENERATE_CHAPTER", createGenerateChapterHandler({ ...shared, ...fakeModelDep() })],
    ["DESLOP", createDeslopHandler({ ...shared, ...fakeModelDep() })],
    ["EXTRACT_MEMORY", createExtractMemoryHandler({ ...shared, ...fakeModelDep() })]
  ]);

  const rewritePolish = createRewritePolishHandler({ ...shared, ...fakeModelDep() });
  handlers.set("REWRITE", rewritePolish);
  handlers.set("POLISH", rewritePolish);
  handlers.set("CONTINUE_CHAPTER", createContinueChapterHandler({ ...shared, ...fakeModelDep() }));
  handlers.set("BATCH_CONTINUE", createBatchContinueHandler({ ...shared, ...fakeModelDep() }));
  handlers.set("REVIEW", createReviewHandler({ ...shared, ...fakeModelDep() }));
  handlers.set("GENERATE_OUTLINE", createGenerateOutlineHandler({ ...shared, ...fakeModelDep() }));

  for (const diagnosticType of DIAGNOSTIC_JOB_TYPES) {
    handlers.set(diagnosticType, createDiagnoseChapterHandler({ ...shared, diagnosticType, ...fakeModelDep() }));
  }

  return handlers;
}
