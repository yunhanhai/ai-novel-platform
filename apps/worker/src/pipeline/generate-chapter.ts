import type { FakeModel } from "./fake-model";

interface PipelineJob {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  jobType: string;
  input: unknown;
}

interface PipelineDeps {
  job: PipelineJob;
  model: FakeModel;
  createStep: (params: { stepKey: string }) => Promise<{ id: string }>;
  updateStep: (params: {
    stepId: string;
    status: "SUCCEEDED";
    outputPreview: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }) => Promise<unknown>;
  saveContentVersion: (params: {
    chapterId: string;
    content: string;
    source: "AI";
    generationJobId: string;
  }) => Promise<{ id: string; versionNo: number }>;
  findChapter: (chapterId: string) => Promise<{ id: string; chapterNo: number; title: string } | null>;
}

export async function runGenerateChapterPipeline(deps: PipelineDeps) {
  const { job, model, createStep, updateStep, saveContentVersion } = deps;

  const input = job.input as { chapterId: string };
  const chapterId = input.chapterId;

  const step = await createStep({ stepKey: "draft" });

  const startedAt = Date.now();
  const result = await model.generate("generate chapter");
  const latencyMs = Date.now() - startedAt;

  const version = await saveContentVersion({
    chapterId,
    content: result.text,
    source: "AI",
    generationJobId: job.id
  });

  await updateStep({
    stepId: step.id,
    status: "SUCCEEDED",
    outputPreview: result.text.slice(0, 200),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs
  });

  return { versionId: version.id, versionNo: version.versionNo };
}
