import {
  appendExtraPrompt,
  extractJsonArray,
  generateAssetDrafts,
  type AssetDraftBaseContext,
  type AssetDraftBaseInput,
  type AssetDraftResult
} from "./asset-drafts";

const TASK_TYPE = "draft_outline";

const LEVELS = ["BOOK", "VOLUME", "CHAPTER", "BEAT"] as const;
type Level = (typeof LEVELS)[number];

export interface OutlineDraft {
  level: Level;
  title: string;
  summary: string;
  orderIndex: number;
}

export interface OutlineDraftInput extends AssetDraftBaseInput {
  projectTitle?: string;
  genreTags?: string[];
  styleTags?: string[];
  premise?: string;
  level?: Level;
  parentTitle?: string;
  existingTitles?: string[];
  startOrderIndex?: number;
}

export async function draftOutlineNodes(
  input: OutlineDraftInput,
  ctx: AssetDraftBaseContext
): Promise<AssetDraftResult<OutlineDraft>> {
  return generateAssetDrafts<OutlineDraftInput, OutlineDraft>({
    input,
    ctx,
    taskType: TASK_TYPE,
    buildPrompt,
    parseResponse,
    buildFake
  });
}

function buildPrompt(input: OutlineDraftInput): string {
  const level = input.level ?? "CHAPTER";
  const parts: string[] = [];
  parts.push(
    `你是大纲编辑。请为这部作品生成 ${input.count} 个层级为「${labelOfLevel(level)}」的大纲条目。`
  );
  if (input.parentTitle) parts.push(`从属于：${input.parentTitle}`);
  if (input.projectTitle) parts.push(`作品名：${input.projectTitle}`);
  if (input.genreTags?.length) parts.push(`题材：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`风格：${input.styleTags.join("、")}`);
  if (input.premise) parts.push(`梗概：${input.premise}`);
  if (input.existingTitles?.length) {
    parts.push(`已有同级标题（请避开重复）：${input.existingTitles.join("、")}`);
  }
  parts.push(
    [
      "请只输出 JSON 数组，不要 Markdown 或解释。每个元素结构：",
      "{",
      '  "title": string,                                // 简洁标题',
      '  "summary": string                               // 2-4 句概述',
      "}"
    ].join("\n")
  );
  parts.push("level 和 orderIndex 由系统自动填充，无需输出。");
  parts.push(appendExtraPrompt(input.extraPrompt).trim());
  return parts.filter(Boolean).join("\n");
}

function parseResponse(text: string, input: OutlineDraftInput): OutlineDraft[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  const level = input.level ?? "CHAPTER";
  const start = typeof input.startOrderIndex === "number" ? input.startOrderIndex : 0;
  const out: OutlineDraft[] = [];
  raw.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) return;
    const summary = typeof rec.summary === "string" ? rec.summary.trim() : "";
    out.push({ level, title, summary, orderIndex: start + idx });
  });
  return out;
}

function buildFake(input: OutlineDraftInput): OutlineDraft[] {
  const level = input.level ?? "CHAPTER";
  const start = typeof input.startOrderIndex === "number" ? input.startOrderIndex : 0;
  const ctx = [
    input.projectTitle,
    input.genreTags?.join("、"),
    input.styleTags?.join("、")
  ]
    .filter(Boolean)
    .join(" · ");
  return Array.from({ length: input.count }, (_, i) => ({
    level,
    title: `${labelOfLevel(level)}${start + i + 1}：转折前夕`,
    summary: ctx
      ? `（${ctx}）核心冲突逐步升级，主角面对一次选择。`
      : "核心冲突逐步升级，主角面对一次选择。",
    orderIndex: start + i
  }));
}

function labelOfLevel(level: Level): string {
  const map: Record<Level, string> = {
    BOOK: "书",
    VOLUME: "卷",
    CHAPTER: "章",
    BEAT: "节拍"
  };
  return map[level];
}
