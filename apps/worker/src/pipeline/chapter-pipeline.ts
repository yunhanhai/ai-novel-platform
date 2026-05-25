import {
  createPerformanceTracker,
  normalizePerformanceBudget,
  type BudgetSkipReason,
  type PerformanceBudget,
  type PerformanceSummary,
  type QualityMode
} from "@ai-novel/shared/generation/performance";
import type { ActivationReport } from "../context/keyword-activation";
import type { MethodologyGuide, StyleGuide } from "../context/build-context-packet";

interface PipelineJob {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  jobType: string;
  input: unknown;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
}

interface FakeModelLike {
  generate: (prompt: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

interface StepRecord {
  stepKey: string;
  status: "SUCCEEDED" | "SKIPPED";
  outputPreview: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

interface PlanOutput {
  chapterGoal: string;
  sceneBeats: { description: string; goal: string }[];
  charactersInScene: string[];
  mustIncludeFacts?: string[];
  hookAgenda?: string[];
  forbiddenMoves?: string[];
}

interface ReviewIssue {
  type: "consistency" | "world_conflict" | "foreshadowing" | "timeline" | "knowledge_boundary" | "ai_slop" | "pacing" | "style_drift" | "methodology_violation";
  detail: string;
  suggestion?: string;
  severity: "info" | "warning" | "error";
}

interface ReviewOutput {
  issues: ReviewIssue[];
  passed: boolean;
}

interface ExtractOutput {
  characterChanges: { characterId?: string; characterName: string; change: string }[];
  worldFacts: { fact: string; worldItemId?: string }[];
  newHooks: { hook: string; threadId?: string }[];
  summary: string;
  chapterSummary: string;
}

interface BuiltContext {
  prompt: string;
  activationReport: ActivationReport;
  contextBudget?: PerformanceSummary["contextBudget"];
  styleGuide?: StyleGuide;
  methodologyGuide?: MethodologyGuide;
}

export interface PipelineDeps {
  job: PipelineJob;
  model: FakeModelLike;
  buildContext: (chapterId: string) => BuiltContext;
  persistVersion: (params: { chapterId: string; content: string; source: "AI"; generationJobId: string }) => Promise<{ id: string; versionNo: number }>;
  createStep: (params: { stepKey: string }) => Promise<{ id: string }>;
  updateStep: (params: {
    stepId: string;
    status: "SUCCEEDED" | "SKIPPED";
    outputPreview: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }) => Promise<unknown>;
  recordModelUsage?: (params: {
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }) => Promise<unknown>;
  performance?: {
    qualityMode: QualityMode;
    budget: PerformanceBudget;
  };
}

interface PipelineResult {
  steps: StepRecord[];
  extracted: ExtractOutput;
  activationReport: ActivationReport;
  performanceSummary: PerformanceSummary;
}

const EMPTY_EXTRACT: ExtractOutput = {
  characterChanges: [],
  worldFacts: [],
  newHooks: [],
  summary: "",
  chapterSummary: "pending"
};

export async function runChapterPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const { job, model, buildContext, persistVersion, createStep, updateStep } = deps;
  const chapterId = resolvePipelineChapterId(job);
  const context = buildContext(chapterId);
  const steps: StepRecord[] = [];
  const performance = deps.performance ?? {
    qualityMode: "balanced" as const,
    budget: normalizePerformanceBudget("balanced", undefined)
  };
  const tracker = createPerformanceTracker(performance);

  async function execStep(key: string, promptText: string, opts: { previewLen?: number } = {}): Promise<string> {
    const step = await createStep({ stepKey: key });
    const started = Date.now();
    const result = await model.generate(promptText);
    const elapsed = Date.now() - started;
    const preview = result.text.slice(0, opts.previewLen ?? 200);

    tracker.recordModelStep({
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: elapsed
    });
    await deps.recordModelUsage?.({
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: elapsed
    });

    await updateStep({
      stepId: step.id,
      status: "SUCCEEDED",
      outputPreview: preview,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: elapsed
    });

    steps.push({
      stepKey: key,
      status: "SUCCEEDED",
      outputPreview: preview,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: elapsed
    });

    return result.text;
  }

  async function skipStep(key: string, reason: BudgetSkipReason): Promise<void> {
    const step = await createStep({ stepKey: key });
    await updateStep({
      stepId: step.id,
      status: "SKIPPED",
      outputPreview: reason,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0
    });
    tracker.recordSkippedStep(key, reason);
    steps.push({
      stepKey: key,
      status: "SKIPPED",
      outputPreview: reason,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0
    });
  }

  async function execOptionalStep(key: string, promptText: string, opts: { previewLen?: number } = {}): Promise<string | null> {
    const allowed = tracker.canRunModelStep(key, { estimatedInputTokens: estimatePromptTokens(promptText) });
    if (!allowed.ok) {
      await skipStep(key, allowed.reason);
      return null;
    }
    return execStep(key, promptText, opts);
  }

  const methodologyHint = context.methodologyGuide
    ? `\n\n[方法论对齐] ${context.methodologyGuide.name}\n${context.methodologyGuide.guideText}`
    : "";

  const planPrompt = `Plan this chapter from context. Return valid JSON only.
${context.prompt}${methodologyHint}

{
  "chapterGoal": "core goal",
  "sceneBeats": [{"description": "scene", "goal": "goal"}],
  "charactersInScene": ["name"],
  "mustIncludeFacts": ["fact"],
  "hookAgenda": ["hook"],
  "forbiddenMoves": ["move"]
}`;

  const planText = await execStep("plan", planPrompt);
  const plan = safeJson<PlanOutput>(planText, {
    chapterGoal: "", sceneBeats: [], charactersInScene: []
  });

  const draftPrompt = `Draft the chapter from the plan and context.

Writing plan:
${JSON.stringify(plan, null, 2)}

${context.prompt}

Return chapter prose only.`;

  let draftText = await execStep("draft", draftPrompt, { previewLen: 500 });

  const reviewExtras: string[] = [];
  if (context.styleGuide?.banned && context.styleGuide.banned.length > 0) {
    reviewExtras.push(`禁用词 ${context.styleGuide.banned.join(", ")} style_drift`);
  }
  if (context.methodologyGuide?.reviewCriteria && context.methodologyGuide.reviewCriteria.length > 0) {
    reviewExtras.push(`方法论必查项 ${context.methodologyGuide.reviewCriteria.join(", ")} methodology_violation`);
  }
  const reviewExtraText = reviewExtras.length > 0 ? `\n\nRequired checks:\n${reviewExtras.map((e) => `- ${e}`).join("\n")}` : "";
  const reviewPrompt = `Review the chapter for consistency, pacing, style, and methodology issues.

Chapter:
${draftText}

Context:
${context.prompt}${reviewExtraText}

Return valid JSON:
{
  "issues": [
    {
      "type": "consistency|world_conflict|foreshadowing|timeline|knowledge_boundary|ai_slop|pacing|style_drift|methodology_violation",
      "detail": "issue",
      "suggestion": "fix",
      "severity": "info|warning|error"
    }
  ],
  "passed": true
}`;

  let review: ReviewOutput = { issues: [], passed: true };
  if (performance.qualityMode === "fast") {
    await skipStep("review", "quality_mode");
  } else {
    const reviewText = await execOptionalStep("review", reviewPrompt);
    review = reviewText ? safeJson<ReviewOutput>(reviewText, { issues: [], passed: true }) : { issues: [], passed: true };
  }

  if (performance.qualityMode === "fast") {
    await skipStep("revise", "quality_mode");
  } else if (review.issues.length > 0) {
    const revisePrompt = `Revise the chapter according to review notes. Return only revised prose.

Review notes:
${JSON.stringify(review.issues, null, 2)}

Original chapter:
${draftText}`;
    const revised = await execOptionalStep("revise", revisePrompt, { previewLen: 500 });
    if (revised) {
      draftText = revised;
    }
  } else {
    await skipStep("revise", "not_applicable");
  }

  {
    const step = await createStep({ stepKey: "persist_version" });
    const started = Date.now();
    const version = await persistVersion({
      chapterId,
      content: draftText,
      source: "AI",
      generationJobId: job.id
    });
    const elapsed = Date.now() - started;

    await updateStep({
      stepId: step.id,
      status: "SUCCEEDED",
      outputPreview: `version ${version.versionNo}`,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: elapsed
    });

    steps.push({
      stepKey: "persist_version",
      status: "SUCCEEDED",
      outputPreview: `version ${version.versionNo}`,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: elapsed
    });
  }

  const extractPrompt = `Extract durable story memory from the final chapter. Return valid JSON only.

Chapter:
${draftText}

Context:
${context.prompt}

{
  "characterChanges": [],
  "worldFacts": [],
  "newHooks": [],
  "summary": "",
  "chapterSummary": ""
}`;

  const extractText = await execOptionalStep("extract_memory", extractPrompt);
  const extracted = extractText ? safeJson<ExtractOutput>(extractText, EMPTY_EXTRACT) : EMPTY_EXTRACT;

  return {
    steps,
    extracted,
    activationReport: context.activationReport,
    performanceSummary: tracker.summary({ contextBudget: context.contextBudget })
  };
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

function resolvePipelineChapterId(job: PipelineJob): string {
  const input = (job.input ?? {}) as { chapterId?: unknown };
  if (typeof input.chapterId === "string" && input.chapterId.length > 0) {
    return input.chapterId;
  }
  if (job.targetEntityType === "CHAPTER" && job.targetEntityId) {
    return job.targetEntityId;
  }
  return "";
}
