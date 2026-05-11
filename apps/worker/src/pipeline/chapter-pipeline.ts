import type { ActivationReport } from "../context/keyword-activation";
import type { StyleGuide, MethodologyGuide } from "../context/build-context-packet";

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
  }) => Promise<unknown>;
}

interface PipelineResult {
  steps: StepRecord[];
  extracted: ExtractOutput;
  activationReport: ActivationReport;
}

export async function runChapterPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const { job, model, buildContext, persistVersion, createStep, updateStep } = deps;
  const input = job.input as { chapterId: string };
  const chapterId = input.chapterId;

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

  // Step 1: plan
  const methodologyHint = context.methodologyGuide
    ? `\n\n[方法论对齐] 请按「${context.methodologyGuide.name}」的结构提示组织 sceneBeats 与 hookAgenda。`
    : "";

  const planPrompt = `你是一位专业的小说策划。根据以下上下文，为本章节制定写作计划。以 JSON 格式输出。

${context.prompt}${methodologyHint}

输出格式：
{
  "chapterGoal": "本章核心目标",
  "sceneBeats": [{"description": "场景描述", "goal": "场景目标"}],
  "charactersInScene": ["角色名"],
  "mustIncludeFacts": ["必须包含的事实"],
  "hookAgenda": ["钩子安排"],
  "forbiddenMoves": ["禁止操作"]
}`;

  const planText = await execStep("plan", planPrompt);
  const plan = safeJson<PlanOutput>(planText, {
    chapterGoal: "", sceneBeats: [], charactersInScene: []
  });

  // Step 2: draft
  const draftPrompt = `你是一位小说作家。根据写作计划和上下文，撰写本章正文。

写作计划：
${JSON.stringify(plan, null, 2)}

${context.prompt}

直接输出正文内容，不需要解释。`;

  let draftText = await execStep("draft", draftPrompt, { previewLen: 500 });

  // Step 3: review
  const reviewExtras: string[] = [];
  if (context.styleGuide?.banned && context.styleGuide.banned.length > 0) {
    reviewExtras.push(`必须扫描禁用词：${context.styleGuide.banned.join("、")}（命中视为 style_drift 错误）`);
  }
  if (context.methodologyGuide?.reviewCriteria && context.methodologyGuide.reviewCriteria.length > 0) {
    reviewExtras.push(`方法论必查项：${context.methodologyGuide.reviewCriteria.join("；")}（违反视为 methodology_violation）`);
  }
  const reviewExtraText = reviewExtras.length > 0 ? `\n\n[必查项]\n${reviewExtras.map((e) => `- ${e}`).join("\n")}` : "";

  const reviewPrompt = `你是一位严格的小说审稿人。检查以下正文是否存在问题。

正文：
${draftText}

上下文：
${context.prompt}${reviewExtraText}

以 JSON 格式输出审计结果：
{
  "issues": [
    {
      "type": "consistency|world_conflict|foreshadowing|timeline|knowledge_boundary|ai_slop|pacing|style_drift|methodology_violation",
      "detail": "问题描述",
      "suggestion": "建议修改",
      "severity": "info|warning|error"
    }
  ],
  "passed": true
}`;

  const reviewText = await execStep("review", reviewPrompt);
  const review = safeJson<ReviewOutput>(reviewText, { issues: [], passed: true });

  // Step 4: revise (only if review has issues)
  if (review.issues.length > 0) {
    const revisePrompt = `根据审稿意见修改以下正文。只输出修改后的正文，不需要解释。

审稿意见：
${JSON.stringify(review.issues, null, 2)}

原文：
${draftText}

修改后正文：`;

    draftText = await execStep("revise", revisePrompt, { previewLen: 500 });
  } else {
    steps.push({
      stepKey: "revise",
      status: "SKIPPED",
      outputPreview: "",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0
    });
  }

  // Step 5: persist_version
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

  // Step 6: extract_memory
  const extractPrompt = `你是小说记忆抽取器。分析本章正文，提取需要记录的信息。以 JSON 格式输出。

正文：
${draftText}

上下文：
${context.prompt}

输出格式：
{
  "characterChanges": [{"characterId": "", "characterName": "角色名", "change": "变化描述"}],
  "worldFacts": [{"fact": "新发现的世界事实", "worldItemId": ""}],
  "newHooks": [{"hook": "新埋设的伏笔", "threadId": ""}],
  "summary": "一句话总结本章",
  "chapterSummary": "详细章节摘要（200字以内）"
}`;

  const extractText = await execStep("extract_memory", extractPrompt);
  const extracted = safeJson<ExtractOutput>(extractText, {
    characterChanges: [], worldFacts: [], newHooks: [],
    summary: "", chapterSummary: "待抽取"
  });

  return {
    steps,
    extracted,
    activationReport: context.activationReport
  };
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    // 提取第一个 JSON 对象
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}
