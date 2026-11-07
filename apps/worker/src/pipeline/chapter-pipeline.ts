import { parseExtraction, type ExtractOutput } from "./extraction-output";
import { classifyModelError } from "./model-error-classifier";
import { parseQualityConstraints, formatQualityConstraints, checkQualityConstraints } from "@ai-novel/shared/generation/quality-constraints";
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
  status: "SUCCEEDED" | "SKIPPED" | "FAILED";
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


interface BuiltContext extends Pick<PerformanceSummary, "contextBudget" | "contextFingerprint"> {
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
    status: "SUCCEEDED" | "SKIPPED" | "FAILED";
    outputPreview: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    promptSnapshot?: string;
  }) => Promise<unknown>;
  performance?: { qualityMode: QualityMode; budget: PerformanceBudget };
}

export interface GenerationWarning {
  stepKey: string;
  code: "MODEL_ERROR" | "INVALID_OUTPUT";
  message: string;
}

interface PipelineResult {
  warnings: GenerationWarning[];
  memoryExtractionSucceeded: boolean;
  steps: StepRecord[];
  extracted: ExtractOutput;
  activationReport: ActivationReport;
  performanceSummary: PerformanceSummary;
}

export async function runChapterPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const { job, model, buildContext, persistVersion, createStep, updateStep } = deps;
  const input = job.input as { chapterId: string; qualityConstraints?: unknown };
  const constraints = parseQualityConstraints(input.qualityConstraints);
  const qualityHint = formatQualityConstraints(constraints);
  const chapterId = input.chapterId;

  const qualityMode = deps.performance?.qualityMode ?? "balanced";
  const budget = deps.performance?.budget ?? normalizePerformanceBudget(qualityMode, undefined);
  const tracker = createPerformanceTracker({ qualityMode, budget });

  const context = buildContext(chapterId);
  const steps: StepRecord[] = [];
  const warnings: GenerationWarning[] = [];

  async function execStep(
    key: string,
    promptText: string,
    opts: { previewLen?: number; optional?: boolean; isValid?: (text: string) => boolean } = {}
  ): Promise<string> {
    const step = await createStep({ stepKey: key });
    const started = Date.now();
    let result: Awaited<ReturnType<FakeModelLike["generate"]>>;
    try {
      result = await model.generate(promptText, {
        maxOutputTokens: budget.maxOutputTokens,
        ...(["plan", "review", "extract_memory"].includes(key) ? { responseFormat: "json_object" as const } : {})
      });
    } catch (error) {
      const elapsed = Date.now() - started;
      tracker.recordModelStep({ inputTokens: 0, outputTokens: 0, latencyMs: elapsed });
      try {
        await updateStep({ stepId: step.id, status: "FAILED", outputPreview: "模型请求失败，未取得供应商用量", inputTokens: 0, outputTokens: 0, latencyMs: elapsed, promptSnapshot: promptText.slice(0, 4000) });
      } catch (recordError) {
        // Optional model failure must not hide a database failure.
        if (opts.optional) throw recordError;
      }
      if (!opts.optional || !classifyModelError(error).retryable) throw error;
      warnings.push({ stepKey: key, code: "MODEL_ERROR", message: "该增强步骤请求失败，已保留有效正文；质量或记忆尚未完成。" });
      steps.push({ stepKey: key, status: "FAILED", outputPreview: "模型请求失败", inputTokens: 0, outputTokens: 0, latencyMs: elapsed });
      return "";
    }
    const elapsed = Date.now() - started;
    const valid = opts.isValid ? opts.isValid(result.text) : true;
    const preview = valid ? result.text.slice(0, opts.previewLen ?? 200) : "模型输出无效，未用于覆盖正文";

    await updateStep({
      stepId: step.id,
      status: valid ? "SUCCEEDED" : "FAILED",
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
      status: valid ? "SUCCEEDED" : "FAILED",
      outputPreview: preview,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: elapsed
    });

    if (!valid) {
      if (!opts.optional) throw new Error("EMPTY_MODEL_OUTPUT: 模型未返回有效正文，原章节未改写");
      warnings.push({ stepKey: key, code: "INVALID_OUTPUT", message: "该增强步骤未返回有效结果，已保留上一份有效正文；需要人工复核。" });
      return "";
    }
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
${qualityHint}

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
${qualityHint}

只输出章节正文，不要任何解释、标题或前后缀。`;

  let draftText = await execStep("draft", draftPrompt, { previewLen: 500, isValid: text => text.trim().length > 0 });

  const reviewExtras: string[] = [];
  if (context.styleGuide?.banned && context.styleGuide.banned.length > 0) {
    reviewExtras.push(`检查是否出现违禁词：${context.styleGuide.banned.join("、")}（命中标记为 style_drift）。`);
  }
  if (context.methodologyGuide?.reviewCriteria && context.methodologyGuide.reviewCriteria.length > 0) {
    reviewExtras.push(`方法论审校标准：${context.methodologyGuide.reviewCriteria.join("；")}（违反标记为 methodology_violation）。`);
  }
  const reviewExtraText = reviewExtras.length > 0 ? `\n\n【必查项】\n${reviewExtras.map((e) => `- ${e}`).join("\n")}` : "";

  const reviewPrompt = `你是一位严格的审校编辑。请审校本章的连贯性、世界逻辑、节奏、文风与方法论问题。
审校须区分可观察事实与人物推断；线索相似或时间异常不等于已证实原因。指出正文中缺少证据却被写成确定事实的结论，并建议保留疑点。
章节正文：
${draftText}

上下文：
${context.prompt}${reviewExtraText}
${qualityHint}

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

  let review: ReviewOutput = { issues: [], passed: false };
  if (qualityMode === "fast") {
    await skipStep("review", "quality_mode");
  } else {
    const reviewCheck = tracker.canRunModelStep("review", { estimatedInputTokens: estimatePromptTokens(reviewPrompt) });
    if (!reviewCheck.ok) {
      await skipStep("review", reviewCheck.reason);
    } else {
      const reviewText = await execStep("review", reviewPrompt, { optional: true, isValid: text => parseReview(text) !== null });
      review = parseReview(reviewText) ?? { issues: [], passed: false };
    }
  }

  if (constraints && qualityMode !== "fast") {
    const measured = checkQualityConstraints(draftText, constraints);
    if (!measured.lengthPassed) review.issues.push({ type: "pacing", severity: "error", detail: `实际${measured.charCount}字，未达到本次字数要求。`, suggestion: qualityHint });
    if (measured.missingFacts.length > 0) review.issues.push({ type: "consistency", severity: "error", detail: `正文缺少指定事实片段：${measured.missingFacts.join("、")}`, suggestion: "把这些事实落实为动作、对话或物证，不要仅重复写作要求。" });
  }

  if (qualityMode === "fast") {
    await skipStep("revise", "quality_mode");
  } else if (review.issues.length === 0) {
    await skipStep("revise", "not_applicable");
  } else {
    const revisePrompt = `请根据审校意见修改本章正文，只返回修改后的正文，不要任何解释。
原始上下文与约束：
${context.prompt}${reviewExtraText}
修订不得新增原文和上下文未提供的人物背景、经历或信息来源。审校建议不是已发生事实；缺少依据时改为待查或人物推测，不能为了补逻辑而编造证据。
审校意见：
${JSON.stringify(review.issues, null, 2)}

原章节：
${draftText}

${qualityHint}
修改后的章节：`;

    const reviseCheck = tracker.canRunModelStep("revise", { estimatedInputTokens: estimatePromptTokens(revisePrompt) });
    if (!reviseCheck.ok) {
      await skipStep("revise", reviseCheck.reason);
    } else {
      const revised = await execStep("revise", revisePrompt, { previewLen: 500, optional: true, isValid: text => text.trim().length > 0 });
      if (revised) draftText = revised;
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
${qualityHint}

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
    const extractText = await execStep("extract_memory", extractPrompt, { optional: true, isValid: text => parseExtraction(text) !== null });
    extracted = parseExtraction(extractText) ?? {
      characterChanges: [], worldFacts: [], newHooks: [],
      summary: "", chapterSummary: "pending extraction"
    };
  }

  return {
    steps,
    warnings,
    extracted,
    memoryExtractionSucceeded: steps.some(step => step.stepKey === "extract_memory" && step.status === "SUCCEEDED"),
    activationReport: context.activationReport,
    performanceSummary: tracker.summary({ contextBudget: context.contextBudget, contextFingerprint: context.contextFingerprint })
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

function parseReview(text: string): ReviewOutput | null {
  const value = safeJson<unknown>(text, null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.passed !== "boolean" || !Array.isArray(raw.issues)) return null;
  const types = ["consistency", "world_conflict", "foreshadowing", "timeline", "knowledge_boundary", "ai_slop", "pacing", "style_drift", "methodology_violation"];
  const issues: ReviewIssue[] = [];
  for (const item of raw.issues) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.type !== "string" || !types.includes(row.type) || typeof row.detail !== "string" || !row.detail.trim() ||
      typeof row.severity !== "string" || !["info", "warning", "error"].includes(row.severity) ||
      (row.suggestion !== undefined && typeof row.suggestion !== "string")) return null;
    issues.push({ type: row.type as ReviewIssue["type"], detail: row.detail, severity: row.severity as ReviewIssue["severity"], ...(typeof row.suggestion === "string" ? { suggestion: row.suggestion } : {}) });
  }
  if (!raw.passed && issues.length === 0) issues.push({ type: "consistency", detail: "审校明确未通过但未列出具体问题，请按原上下文重新核查事实依据并修订。", severity: "warning" });
  return { passed: raw.passed, issues };
}
