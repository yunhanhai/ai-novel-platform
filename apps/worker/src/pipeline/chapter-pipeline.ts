import type { ActivationReport } from "../context/keyword-activation";
import type { StyleGuide, MethodologyGuide } from "../context/build-context-packet";
import type { ModelGenerateOptions } from "@ai-novel/model-adapters";
import { estimateTokens as estimatePromptTokens } from "@ai-novel/shared/generation/token-estimate";
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
  generate: (prompt: string, options?: ModelGenerateOptions) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
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
    const result = await model.generate(promptText, { maxOutputTokens: budget.maxOutputTokens });
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
    ? `\n\n【方法论对齐】组织 sceneBeats 与 hookAgenda 时请遵循《${context.methodologyGuide.name}》。\n${context.methodologyGuide.guideText}`
    : "";

  const planPrompt = `你是一位专业的小说策划。请根据下面的上下文，为本章设计写作计划。只返回合法 JSON，不要任何解释。
${context.prompt}${methodologyHint}

输出结构：
{
  "chapterGoal": "本章核心目标",
  "sceneBeats": [{"description": "场景描述", "goal": "场景目标"}],
  "charactersInScene": ["出场角色名"],
  "mustIncludeFacts": ["必须出现的事实"],
  "hookAgenda": ["需要埋设或回收的钩子"],
  "forbiddenMoves": ["应当避免的写法"]
}`;

  const planText = await execStep("plan", planPrompt);
  const plan = safeJson<PlanOutput>(planText, {
    chapterGoal: "", sceneBeats: [], charactersInScene: []
  });

  const draftPrompt = `你是一位小说作者。请根据写作计划与上下文完成本章正文。
写作计划：
${JSON.stringify(plan, null, 2)}

${context.prompt}

只输出章节正文，不要任何解释、标题或前后缀。`;

  let draftText = await execStep("draft", draftPrompt, { previewLen: 500 });

  const reviewExtras: string[] = [];
  if (context.styleGuide?.banned && context.styleGuide.banned.length > 0) {
    reviewExtras.push(`检查是否出现违禁词：${context.styleGuide.banned.join("、")}（命中标记为 style_drift）。`);
  }
  if (context.methodologyGuide?.reviewCriteria && context.methodologyGuide.reviewCriteria.length > 0) {
    reviewExtras.push(`方法论审校标准：${context.methodologyGuide.reviewCriteria.join("；")}（违反标记为 methodology_violation）。`);
  }
  const reviewExtraText = reviewExtras.length > 0 ? `\n\n【必查项】\n${reviewExtras.map((e) => `- ${e}`).join("\n")}` : "";

  const reviewPrompt = `你是一位严格的审校编辑。请审校本章的连贯性、世界逻辑、节奏、文风与方法论问题。
章节正文：
${draftText}

上下文：
${context.prompt}${reviewExtraText}

只返回合法 JSON，不要任何解释：
{
  "issues": [
    {
      "type": "consistency|world_conflict|foreshadowing|timeline|knowledge_boundary|ai_slop|pacing|style_drift|methodology_violation",
      "detail": "问题说明",
      "suggestion": "修改建议",
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
    const revisePrompt = `请根据审校意见修改本章正文，只返回修改后的正文，不要任何解释。
审校意见：
${JSON.stringify(review.issues, null, 2)}

原章节：
${draftText}

修改后的章节：`;

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

  const extractPrompt = `你是一位小说记忆抽取器。请分析最终章节，抽取需要长期留存的故事状态。只返回合法 JSON，不要任何解释。
章节正文：
${draftText}

上下文：
${context.prompt}

输出结构：
{
  "characterChanges": [{"characterId": "", "characterName": "角色名", "change": "变化说明"}],
  "worldFacts": [{"fact": "新的世界观事实", "worldItemId": ""}],
  "newHooks": [{"hook": "新埋下的伏笔", "threadId": ""}],
  "summary": "一句话章节摘要",
  "chapterSummary": "300 字以内的详细章节摘要"
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