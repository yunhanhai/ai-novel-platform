import type { ActivationReport } from "../context/keyword-activation";
import type { StyleGuide, MethodologyGuide } from "../context/build-context-packet";
import {
  createPerformanceTracker,
  normalizePerformanceBudget,
  type BudgetSkipReason,
  type PerformanceBudget,
  type PerformanceSummary,
  type QualityMode
} from "@ai-novel/shared/generation/performance";

interface PipelineJob {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  jobType: string;
  input: unknown;
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
    promptSnapshot?: string;
  }) => Promise<unknown>;
  performance?: { qualityMode: QualityMode; budget: PerformanceBudget };
}

interface PipelineResult {
  steps: StepRecord[];
  extracted: ExtractOutput;
  activationReport: ActivationReport;
  performanceSummary: PerformanceSummary;
}

export async function runChapterPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const { job, model, buildContext, persistVersion, createStep, updateStep } = deps;
  const input = job.input as { chapterId: string };
  const chapterId = input.chapterId;

  const qualityMode = deps.performance?.qualityMode ?? "balanced";
  const budget = deps.performance?.budget ?? normalizePerformanceBudget(qualityMode, undefined);
  const tracker = createPerformanceTracker({ qualityMode, budget });

  const context = buildContext(chapterId);
  const steps: StepRecord[] = [];

  async function execStep(
    key: string,
    promptText: string,
    opts: { previewLen?: number } = {}
  ): Promise<string> {
    const step = await createStep({ stepKey: key });
    const started = Date.now();
    const result = await model.generate(promptText);
    const elapsed = Date.now() - started;
    const preview = result.text.slice(0, opts.previewLen ?? 200);

    await updateStep({
      stepId: step.id,
      status: "SUCCEEDED",
      outputPreview: preview,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: elapsed,
      promptSnapshot: promptText.slice(0, 4000)
    });

    tracker.recordModelStep({
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

  const methodologyHint = context.methodologyGuide
    ? `\n\n[Methodology alignment] Follow "${context.methodologyGuide.name}" when organizing sceneBeats and hookAgenda.\n${context.methodologyGuide.guideText}`
    : "";

  const planPrompt = `You are a professional fiction planner. Build a chapter writing plan from the context below. Return valid JSON only.
${context.prompt}${methodologyHint}

Output schema:
{
  "chapterGoal": "core goal of this chapter",
  "sceneBeats": [{"description": "scene description", "goal": "scene goal"}],
  "charactersInScene": ["character name"],
  "mustIncludeFacts": ["facts that must appear"],
  "hookAgenda": ["hooks to plant or pay off"],
  "forbiddenMoves": ["moves to avoid"]
}`;

  const planText = await execStep("plan", planPrompt);
  const plan = safeJson<PlanOutput>(planText, {
    chapterGoal: "", sceneBeats: [], charactersInScene: []
  });

  const draftPrompt = `You are a fiction writer. Draft the chapter from the writing plan and context.
Writing plan:
${JSON.stringify(plan, null, 2)}

${context.prompt}

Return the chapter prose only, without explanation.`;

  let draftText = await execStep("draft", draftPrompt, { previewLen: 500 });

  const reviewExtras: string[] = [];
  if (context.styleGuide?.banned && context.styleGuide.banned.length > 0) {
    reviewExtras.push(`Scan for banned words: ${context.styleGuide.banned.join(", ")} (mark hits as style_drift).`);
  }
  if (context.methodologyGuide?.reviewCriteria && context.methodologyGuide.reviewCriteria.length > 0) {
    reviewExtras.push(`Methodology review criteria: ${context.methodologyGuide.reviewCriteria.join("; ")} (mark violations as methodology_violation).`);
  }
  const reviewExtraText = reviewExtras.length > 0 ? `\n\n[Required checks]\n${reviewExtras.map((e) => `- ${e}`).join("\n")}` : "";

  const reviewPrompt = `You are a strict fiction editor. Review the chapter for continuity, world logic, pacing, style, and methodology issues.
Chapter:
${draftText}

Context:
${context.prompt}${reviewExtraText}

Return valid JSON only:
{
  "issues": [
    {
      "type": "consistency|world_conflict|foreshadowing|timeline|knowledge_boundary|ai_slop|pacing|style_drift|methodology_violation",
      "detail": "issue description",
      "suggestion": "suggested fix",
      "severity": "info|warning|error"
    }
  ],
  "passed": true
}`;

  let review: ReviewOutput = { issues: [], passed: true };
  if (qualityMode === "fast") {
    await skipStep("review", "quality_mode");
  } else {
    const reviewCheck = tracker.canRunModelStep("review", { estimatedInputTokens: estimatePromptTokens(reviewPrompt) });
    if (!reviewCheck.ok) {
      await skipStep("review", reviewCheck.reason);
    } else {
      const reviewText = await execStep("review", reviewPrompt);
      review = safeJson<ReviewOutput>(reviewText, { issues: [], passed: true });
    }
  }

  if (qualityMode === "fast") {
    await skipStep("revise", "quality_mode");
  } else if (review.issues.length === 0) {
    await skipStep("revise", "not_applicable");
  } else {
    const revisePrompt = `Revise the chapter according to the review notes. Return only the revised prose, without explanation.
Review notes:
${JSON.stringify(review.issues, null, 2)}

Original chapter:
${draftText}

Revised chapter:`;

    const reviseCheck = tracker.canRunModelStep("revise", { estimatedInputTokens: estimatePromptTokens(revisePrompt) });
    if (!reviseCheck.ok) {
      await skipStep("revise", reviseCheck.reason);
    } else {
      draftText = await execStep("revise", revisePrompt, { previewLen: 500 });
    }
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

  const extractPrompt = `You are a fiction memory extractor. Analyze the final chapter and extract durable story state. Return valid JSON only.
Chapter:
${draftText}

Context:
${context.prompt}

Output schema:
{
  "characterChanges": [{"characterId": "", "characterName": "character name", "change": "change description"}],
  "worldFacts": [{"fact": "new world fact", "worldItemId": ""}],
  "newHooks": [{"hook": "new foreshadowing hook", "threadId": ""}],
  "summary": "one sentence chapter summary",
  "chapterSummary": "detailed chapter summary within 300 characters"
}`;

  let extracted: ExtractOutput = {
    characterChanges: [], worldFacts: [], newHooks: [],
    summary: "", chapterSummary: "pending extraction"
  };
  const extractCheck = tracker.canRunModelStep("extract_memory", { estimatedInputTokens: estimatePromptTokens(extractPrompt) });
  if (!extractCheck.ok) {
    await skipStep("extract_memory", extractCheck.reason);
  } else {
    const extractText = await execStep("extract_memory", extractPrompt);
    extracted = safeJson<ExtractOutput>(extractText, {
      characterChanges: [], worldFacts: [], newHooks: [],
      summary: "", chapterSummary: "pending extraction"
    });
  }

  return {
    steps,
    extracted,
    activationReport: context.activationReport,
    performanceSummary: tracker.summary()
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