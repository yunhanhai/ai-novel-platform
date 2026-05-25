import type { PrismaClient } from "@ai-novel/db";
import type { GenerationJob, JobHandler, UpdateStatusFn } from "./poll";
import { createDeslopHandler } from "./pipeline/deslop-handler";
import { createDiagnoseChapterHandler } from "./pipeline/diagnose-chapter-handler";
import { createExtractMemoryHandler } from "./pipeline/extract-memory-handler";
import { createFakeModel } from "./pipeline/fake-model";
import { createGenerateChapterHandler } from "./pipeline/generate-chapter-handler";

type ModelLike = ReturnType<typeof createFakeModel>;

interface HandlerFactoryDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  resolveModel?: (job: GenerationJob) => Promise<ModelLike | null>;
  useFakeModel: boolean;
}

export function createHandlers(deps: HandlerFactoryDeps): Map<string, JobHandler> {
  const fakeModelDeps = deps.useFakeModel ? { model: createFakeModel() } : {};
  const commonDeps = {
    prisma: deps.prisma,
    updateJobStatus: deps.updateJobStatus,
    resolveModel: deps.resolveModel,
    ...fakeModelDeps
  };
  const diagnoseHandler = createDiagnoseChapterHandler(commonDeps);

  return new Map<string, JobHandler>([
    ["GENERATE_CHAPTER", createGenerateChapterHandler(commonDeps)],
    ["DESLOP", createDeslopHandler(commonDeps)],
    ["EXTRACT_MEMORY", createExtractMemoryHandler(commonDeps)],
    ["DIAGNOSE_CHAPTER", diagnoseHandler],
    ["READER_SIMULATION", diagnoseHandler],
    ["STYLE_DRIFT_CHECK", diagnoseHandler],
    ["CONTINUITY_CHECK", diagnoseHandler]
  ]);
}
