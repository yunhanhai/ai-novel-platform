import type { PrismaClient } from "@ai-novel/db";
import {
  resolveModelProfile,
  createAdapter,
  type ProviderRecord
} from "@ai-novel/model-adapters";
import {
  getMethodologyTemplate,
  type MethodType,
  type OutlineSkeletonNode
} from "@ai-novel/shared/methodology/templates";

// 25 秒：足够 LLM 短 prompt 返回，超时降级保护用户体验
const DRAFT_TIMEOUT_MS = 25_000;

const DRAFT_TASK_TYPE = "draft_wizard";

export interface DraftPremiseInput {
  projectTitle?: string;
  genreTags?: string[];
  styleTags?: string[];
  methodType?: MethodType | "none" | null;
  oneLiner?: string;
  keyElements?: string;
}

export interface DraftPremiseResult {
  text: string;
  degraded: boolean;
}

export interface DraftOutlineInput {
  methodType: MethodType;
  genreTags?: string[];
  styleTags?: string[];
  premise?: string;
}

export interface DraftOutlineNode {
  level: "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";
  title: string;
  summary: string;
  orderIndex: number;
}

export interface DraftOutlineResult {
  nodes: DraftOutlineNode[];
  degraded: boolean;
}

export interface DraftDeps {
  prisma: PrismaClient;
  organizationId: string;
  projectId?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * 同步起草梗概：fake 模式或真实模式失败时都会返回 degraded=true 的占位文本
 */
export async function draftPremise(
  input: DraftPremiseInput,
  deps: DraftDeps
): Promise<DraftPremiseResult> {
  const env = deps.env ?? process.env;

  if (env.USE_FAKE_MODEL === "true") {
    return { text: buildFakePremise(input), degraded: false };
  }

  const prompt = buildPremisePrompt(input);
  const text = await generateWithFallback(prompt, deps, env);
  if (text === null) {
    return { text: buildFakePremise(input), degraded: true };
  }
  return { text: text.trim(), degraded: false };
}

/**
 * 同步起草大纲：以方法论模板节点为骨架，AI 只扩写每条 summary
 */
export async function draftOutline(
  input: DraftOutlineInput,
  deps: DraftDeps
): Promise<DraftOutlineResult> {
  const env = deps.env ?? process.env;
  const template = safeGetTemplate(input.methodType);
  if (!template) {
    return { nodes: [], degraded: false };
  }

  const skeleton = template.outlineMetadata.nodes;
  if (env.USE_FAKE_MODEL === "true") {
    return { nodes: skeleton.map((n) => toFakeNode(n, input)), degraded: false };
  }

  const prompt = buildOutlinePrompt(input, skeleton);
  const text = await generateWithFallback(prompt, deps, env);
  if (text === null) {
    return { nodes: skeleton.map((n) => toFakeNode(n, input)), degraded: true };
  }

  return { nodes: parseOutlineFromText(text, skeleton, input), degraded: false };
}

// ---------- 内部实现 ----------

async function generateWithFallback(
  prompt: string,
  deps: DraftDeps,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  if (!deps.projectId) {
    // 没有 projectId 时只能解析 org 级 profile；继续尝试
  }
  const encryptionKey = getEncryptionKey(env);

  try {
    const profile = await resolveModelProfile(
      {
        organizationId: deps.organizationId,
        projectId: deps.projectId ?? "",
        taskType: DRAFT_TASK_TYPE
      },
      deps.prisma as unknown as Parameters<typeof resolveModelProfile>[1]
    );
    if (!profile) return null;

    const provider = profile.provider as ProviderRecord | undefined;
    if (!provider) return null;
    const modelName = profile.modelName as string | undefined;
    if (!modelName) return null;
    if (provider.authMode === "USER_KEY" && !encryptionKey) return null;

    const adapter = await createAdapter(provider, modelName, { encryptionKey, env });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      const result = await Promise.race([
        adapter.generate(prompt),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new Error("DRAFT_TIMEOUT"));
          });
        })
      ]);
      return result.text;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function getEncryptionKey(env: NodeJS.ProcessEnv): Buffer | null {
  const hex = env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex.slice(0, 64), "hex");
}

function safeGetTemplate(methodType: MethodType) {
  try {
    return getMethodologyTemplate(methodType);
  } catch {
    return null;
  }
}

function buildPremisePrompt(input: DraftPremiseInput): string {
  const parts: string[] = [];
  parts.push("你是一个故事策划，请根据以下要素，生成一段 200~400 字的故事梗概：");
  if (input.projectTitle) parts.push(`作品名：${input.projectTitle}`);
  if (input.genreTags?.length) parts.push(`题材标签：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`叙事风格：${input.styleTags.join("、")}`);
  if (input.methodType && input.methodType !== "none") {
    parts.push(`写作方法论：${input.methodType}`);
  }
  if (input.oneLiner) parts.push(`一句话核心：${input.oneLiner}`);
  if (input.keyElements) parts.push(`关键元素：${input.keyElements}`);
  parts.push("请直接输出梗概文本，不要附加多余解释或 Markdown 标记。");
  return parts.join("\n");
}

function buildOutlinePrompt(
  input: DraftOutlineInput,
  skeleton: ReadonlyArray<OutlineSkeletonNode>
): string {
  const parts: string[] = [];
  parts.push("以下是方法论提供的大纲骨架，请基于上下文扩写每条 summary（保持 title 不变）。");
  if (input.genreTags?.length) parts.push(`题材：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`风格：${input.styleTags.join("、")}`);
  if (input.premise) parts.push(`梗概：${input.premise}`);
  parts.push("骨架节点：");
  for (const node of skeleton) {
    parts.push(`- [${node.orderIndex}] ${node.title} —— ${node.summary}`);
  }
  parts.push("请按相同顺序输出每个节点的扩写后 summary，每行格式：`<orderIndex>|<summary>`");
  return parts.join("\n");
}

function buildFakePremise(input: DraftPremiseInput): string {
  const titlePart = input.projectTitle ? `《${input.projectTitle}》` : "本作";
  const genrePart = input.genreTags?.length ? `融合${input.genreTags.join("、")}` : "";
  const stylePart = input.styleTags?.length ? `以${input.styleTags.join("、")}的笔调` : "";
  const corePart = input.oneLiner ? `核心冲突围绕「${input.oneLiner}」` : "讲述一段意义非凡的旅程";
  const elementsPart = input.keyElements
    ? `重点呈现：${input.keyElements}`
    : "在多组角色与抉择间展开";

  return [
    `${titlePart}${genrePart ? `——一个${genrePart}的故事` : ""}。`,
    `${stylePart ? stylePart + "，" : ""}${corePart}。`,
    `${elementsPart}。`,
    "（演示模式占位梗概，请按需修改或重抽。）"
  ].join("");
}

function toFakeNode(node: OutlineSkeletonNode, input: DraftOutlineInput): DraftOutlineNode {
  const ctx: string[] = [];
  if (input.genreTags?.length) ctx.push(input.genreTags.join("、"));
  if (input.styleTags?.length) ctx.push(input.styleTags.join("、"));
  const ctxLabel = ctx.length > 0 ? `（${ctx.join(" · ")}）` : "";
  return {
    level: toUpperLevel(node.level),
    title: node.title,
    summary: `${node.summary}${ctxLabel}`,
    orderIndex: node.orderIndex
  };
}

function toUpperLevel(level: OutlineSkeletonNode["level"]): DraftOutlineNode["level"] {
  switch (level) {
    case "book": return "BOOK";
    case "volume": return "VOLUME";
    case "chapter": return "CHAPTER";
    case "beat": return "BEAT";
  }
}

/**
 * 真实模式下 LLM 按 "<orderIndex>|<summary>" 输出，按行解析。
 * 找不到对应行时回退到 skeleton.summary。
 */
function parseOutlineFromText(
  text: string,
  skeleton: ReadonlyArray<OutlineSkeletonNode>,
  input: DraftOutlineInput
): DraftOutlineNode[] {
  const map = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*\|\s*(.+?)\s*$/);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    const idx = Number(m[1]);
    if (Number.isFinite(idx)) {
      map.set(idx, m[2]);
    }
  }

  return skeleton.map((node) => {
    const aiSummary = map.get(node.orderIndex);
    const fake = toFakeNode(node, input);
    return {
      level: fake.level,
      title: node.title,
      summary: aiSummary && aiSummary.trim().length > 0 ? aiSummary.trim() : fake.summary,
      orderIndex: node.orderIndex
    };
  });
}
