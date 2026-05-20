import {
  appendExtraPrompt,
  extractJsonArray,
  generateAssetDrafts,
  type AssetDraftBaseContext,
  type AssetDraftBaseInput,
  type AssetDraftResult
} from "./asset-drafts";

const TASK_TYPE = "draft_world_item";

const ITEM_TYPES = [
  "location", "faction", "artifact", "rule",
  "power_system", "timeline_event", "creature", "other"
] as const;
type ItemType = (typeof ITEM_TYPES)[number];

export interface WorldItemDraft {
  name: string;
  itemType: ItemType;
  aliases: string[];
  summary: string;
  detail: string;
  activationKeywords: string[];
  priority: number;
}

export interface WorldItemDraftInput extends AssetDraftBaseInput {
  projectTitle?: string;
  genreTags?: string[];
  styleTags?: string[];
  premise?: string;
  focusType?: ItemType;
  existingNames?: string[];
}

export async function draftWorldItems(
  input: WorldItemDraftInput,
  ctx: AssetDraftBaseContext
): Promise<AssetDraftResult<WorldItemDraft>> {
  return generateAssetDrafts<WorldItemDraftInput, WorldItemDraft>({
    input,
    ctx,
    taskType: TASK_TYPE,
    buildPrompt,
    parseResponse,
    buildFake
  });
}

function buildPrompt(input: WorldItemDraftInput): string {
  const parts: string[] = [];
  parts.push(
    `你是世界观策划。请为这部作品设计 ${input.count} 条世界观条目${
      input.focusType ? `，类型集中在「${labelOfType(input.focusType)}」` : "（覆盖地点/势力/道具/规则等不同类型）"
    }。`
  );
  if (input.projectTitle) parts.push(`作品名：${input.projectTitle}`);
  if (input.genreTags?.length) parts.push(`题材：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`风格：${input.styleTags.join("、")}`);
  if (input.premise) parts.push(`梗概：${input.premise}`);
  if (input.existingNames?.length) {
    parts.push(`已有条目（请避开重名）：${input.existingNames.join("、")}`);
  }
  parts.push(
    [
      "请只输出 JSON 数组，不要 Markdown 或解释。每个元素结构：",
      "{",
      '  "name": string,                                       // 条目名',
      `  "itemType": ${ITEM_TYPES.map((t) => `"${t}"`).join("|")},`,
      '  "aliases": string[],',
      '  "summary": string,                                    // 一句话',
      '  "detail": string,                                     // 2-4 句详细说明',
      '  "activationKeywords": string[],                       // 触发该条目的关键词',
      '  "priority": number                                    // 0-10'
    ].join("\n") + "\n}"
  );
  parts.push(appendExtraPrompt(input.extraPrompt).trim());
  return parts.filter(Boolean).join("\n");
}

function parseResponse(text: string): WorldItemDraft[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  const out: WorldItemDraft[] = [];
  for (const item of raw) {
    const norm = normalize(item);
    if (norm) out.push(norm);
  }
  return out;
}

function normalize(item: unknown): WorldItemDraft | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const name = toStr(rec.name);
  if (!name) return null;
  return {
    name,
    itemType: isType(rec.itemType) ? rec.itemType : "other",
    aliases: toStrArr(rec.aliases),
    summary: toStr(rec.summary),
    detail: toStr(rec.detail),
    activationKeywords: toStrArr(rec.activationKeywords),
    priority: clampPriority(rec.priority)
  };
}

function isType(value: unknown): value is ItemType {
  return typeof value === "string" && (ITEM_TYPES as readonly string[]).includes(value);
}

function clampPriority(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.floor(n)));
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStrArr(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function labelOfType(type: ItemType): string {
  const map: Record<ItemType, string> = {
    location: "地点",
    faction: "势力",
    artifact: "道具",
    rule: "规则",
    power_system: "力量体系",
    timeline_event: "时间事件",
    creature: "生物",
    other: "其他"
  };
  return map[type];
}

function buildFake(input: WorldItemDraftInput): WorldItemDraft[] {
  const presets: Array<Omit<WorldItemDraft, "name">> = [
    {
      itemType: "location",
      aliases: [],
      summary: "故事主舞台，承载多条线索",
      detail: "地形复杂，存在派系冲突与历史遗迹。",
      activationKeywords: ["地点", "城"],
      priority: 5
    },
    {
      itemType: "faction",
      aliases: [],
      summary: "区域内的核心势力之一",
      detail: "有明确利益与目标，与主角立场存在张力。",
      activationKeywords: ["势力"],
      priority: 4
    },
    {
      itemType: "artifact",
      aliases: [],
      summary: "推动剧情的关键物件",
      detail: "拥有特殊作用，使用代价不容忽视。",
      activationKeywords: ["道具"],
      priority: 3
    }
  ];
  return Array.from({ length: input.count }, (_, i) => {
    const preset = presets[i % presets.length]!;
    const tag = input.genreTags?.[0] ?? "";
    return {
      ...preset,
      name: `${tag ? `${tag}·` : ""}AI世界条目${i + 1}`
    };
  });
}
