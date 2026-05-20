import type { PrismaClient } from "@ai-novel/db";
import {
  resolveModelProfile,
  createAdapter,
  type ProviderRecord
} from "@ai-novel/model-adapters";

// 25 秒，与 wizard-drafts 一致；批量草稿可能比单梗概略长，但不超 25s
const DRAFT_TIMEOUT_MS = 25_000;

export interface AssetDraftBaseInput {
  count: number;
  extraPrompt?: string;
}

export interface AssetDraftBaseContext {
  projectId: string;
  organizationId: string;
  prisma: PrismaClient;
  env?: NodeJS.ProcessEnv;
}

export interface AssetDraftResult<T> {
  drafts: T[];
  degraded: boolean;
}

/**
 * 资产草稿生成的通用骨架。
 * 调用方提供:
 *   - taskType：用于 ModelProfile resolver
 *   - buildPrompt：把输入和 count 组装为对 LLM 的指令
 *   - parseResponse：把 LLM 输出文本解析为结构化数组
 *   - buildFake：占位草稿生成器（fake 模式 & 真实模式失败兜底）
 *
 * 返回 degraded=true 时表示走了 fake 兜底（仅 fake 模式以外）。
 */
export async function generateAssetDrafts<TInput extends AssetDraftBaseInput, TItem>(opts: {
  input: TInput;
  ctx: AssetDraftBaseContext;
  taskType: string;
  buildPrompt: (input: TInput) => string;
  parseResponse: (text: string, input: TInput) => TItem[];
  buildFake: (input: TInput) => TItem[];
}): Promise<AssetDraftResult<TItem>> {
  const env = opts.ctx.env ?? process.env;
  const count = clampCount(opts.input.count);
  const normalized = { ...opts.input, count };

  if (env.USE_FAKE_MODEL === "true") {
    return { drafts: opts.buildFake(normalized), degraded: false };
  }

  const prompt = opts.buildPrompt(normalized);
  const text = await generateWithFallback(prompt, opts.ctx, env, opts.taskType);
  if (text === null) {
    return { drafts: opts.buildFake(normalized), degraded: true };
  }

  try {
    const parsed = opts.parseResponse(text, normalized);
    if (parsed.length === 0) {
      return { drafts: opts.buildFake(normalized), degraded: true };
    }
    return { drafts: parsed, degraded: false };
  } catch {
    return { drafts: opts.buildFake(normalized), degraded: true };
  }
}

export function clampCount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

/**
 * 尝试从 LLM 文本里提取 JSON 数组：
 * 1. 先尝试整体 JSON.parse
 * 2. 再尝试匹配 ```json ... ``` 代码块
 * 3. 最后匹配第一个 [ 到 最后一个 ] 之间的内容
 *
 * 任意一步成功且产物是数组就返回；都失败返回 null。
 */
export function extractJsonArray(text: string): unknown[] | null {
  const direct = tryParse(text);
  if (Array.isArray(direct)) return direct;

  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock?.[1]) {
    const parsed = tryParse(codeBlock[1]);
    if (Array.isArray(parsed)) return parsed;
  }

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const parsed = tryParse(text.slice(firstBracket, lastBracket + 1));
    if (Array.isArray(parsed)) return parsed;
  }

  return null;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function generateWithFallback(
  prompt: string,
  ctx: AssetDraftBaseContext,
  env: NodeJS.ProcessEnv,
  taskType: string
): Promise<string | null> {
  const encryptionKey = getEncryptionKey(env);
  if (!encryptionKey) return null;

  try {
    const profile = await resolveModelProfile(
      {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        taskType
      },
      ctx.prisma as unknown as Parameters<typeof resolveModelProfile>[1]
    );
    if (!profile) return null;

    const provider = profile.provider as ProviderRecord | undefined;
    if (!provider) return null;
    const modelName = profile.modelName as string | undefined;
    if (!modelName) return null;

    const adapter = await createAdapter(provider, modelName, { encryptionKey, env });
    const result = await withTimeout(adapter.generate(prompt), DRAFT_TIMEOUT_MS);
    return result.text;
  } catch {
    return null;
  }
}

function getEncryptionKey(env: NodeJS.ProcessEnv): Buffer | null {
  const hex = env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex.slice(0, 64), "hex");
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DRAFT_TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 用户补充说明拼接到 prompt 末尾的统一方式。空字符串/缺省返回空。
 */
export function appendExtraPrompt(extra: string | undefined): string {
  const trimmed = (extra ?? "").trim();
  if (!trimmed) return "";
  return `\n额外要求：${trimmed}`;
}
