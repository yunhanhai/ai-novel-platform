import {
  appendExtraPrompt,
  extractJsonArray,
  generateAssetDrafts,
  type AssetDraftBaseContext,
  type AssetDraftBaseInput,
  type AssetDraftResult
} from "./asset-drafts";

const TASK_TYPE = "draft_character";

const ROLE_TYPES = ["protagonist", "antagonist", "supporting", "minor"] as const;
type RoleType = (typeof ROLE_TYPES)[number];

export interface CharacterDraft {
  name: string;
  roleType: RoleType;
  aliases: string[];
  personality: string;
  motivation: string;
  speechPattern: string;
  arc: string;
}

export interface CharacterDraftInput extends AssetDraftBaseInput {
  projectTitle?: string;
  genreTags?: string[];
  styleTags?: string[];
  premise?: string;
  existingNames?: string[];
}

export async function draftCharacters(
  input: CharacterDraftInput,
  ctx: AssetDraftBaseContext
): Promise<AssetDraftResult<CharacterDraft>> {
  return generateAssetDrafts<CharacterDraftInput, CharacterDraft>({
    input,
    ctx,
    taskType: TASK_TYPE,
    buildPrompt,
    parseResponse,
    buildFake
  });
}

function buildPrompt(input: CharacterDraftInput): string {
  const parts: string[] = [];
  parts.push(
    `你是故事策划。请基于以下设定为这部作品设计 ${input.count} 个角色，覆盖主角/反派/配角/次要中适合的类型组合。`
  );
  if (input.projectTitle) parts.push(`作品名：${input.projectTitle}`);
  if (input.genreTags?.length) parts.push(`题材：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`风格：${input.styleTags.join("、")}`);
  if (input.premise) parts.push(`梗概：${input.premise}`);
  if (input.existingNames?.length) {
    parts.push(`已有角色（请避开重名）：${input.existingNames.join("、")}`);
  }
  parts.push(
    [
      "请只输出 JSON 数组，不要 Markdown 或解释。每个元素结构：",
      "{",
      '  "name": string,                           // 简洁中文名',
      '  "roleType": "protagonist"|"antagonist"|"supporting"|"minor",',
      '  "aliases": string[],                      // 0-3 个别名，可为空数组',
      '  "personality": string,                    // 30 字内',
      '  "motivation": string,                     // 一句话核心驱动',
      '  "speechPattern": string,                  // 一句话语言特色',
      '  "arc": string                             // 一句话成长弧光'
    ].join("\n") + "\n}"
  );
  parts.push(appendExtraPrompt(input.extraPrompt).trim());
  return parts.filter(Boolean).join("\n");
}

function parseResponse(text: string): CharacterDraft[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  const out: CharacterDraft[] = [];
  for (const item of raw) {
    const normalized = normalize(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalize(item: unknown): CharacterDraft | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (!name) return null;
  const roleType = isRole(rec.roleType) ? rec.roleType : "supporting";
  return {
    name,
    roleType,
    aliases: toStringArr(rec.aliases),
    personality: toStr(rec.personality),
    motivation: toStr(rec.motivation),
    speechPattern: toStr(rec.speechPattern),
    arc: toStr(rec.arc)
  };
}

function isRole(value: unknown): value is RoleType {
  return typeof value === "string" && (ROLE_TYPES as readonly string[]).includes(value);
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArr(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function buildFake(input: CharacterDraftInput): CharacterDraft[] {
  const tagSuffix = [...(input.genreTags ?? []), ...(input.styleTags ?? [])]
    .filter(Boolean)
    .join("·");
  const presets: Array<Omit<CharacterDraft, "name">> = [
    {
      roleType: "protagonist",
      aliases: [],
      personality: "冷静、内敛、行动力强",
      motivation: "守护故乡免遭吞噬",
      speechPattern: "言简意赅，少用形容词",
      arc: "从拒绝命运到主动承担"
    },
    {
      roleType: "antagonist",
      aliases: [],
      personality: "深沉、自负、惯于布局",
      motivation: "复刻被时代抛弃的秩序",
      speechPattern: "引经据典、夹叙夹议",
      arc: "理想腐烂为偏执"
    },
    {
      roleType: "supporting",
      aliases: [],
      personality: "乐观、嘴硬心软",
      motivation: "替主角承担情感出口",
      speechPattern: "调侃 + 网络口语",
      arc: "从依赖到独立"
    },
    {
      roleType: "minor",
      aliases: [],
      personality: "谨慎、信息掮客",
      motivation: "在乱局中求生",
      speechPattern: "压低声音 + 短句",
      arc: "由灰转白或由白转灰"
    }
  ];
  return Array.from({ length: input.count }, (_, i) => {
    const preset = presets[i % presets.length]!;
    return {
      name: `${tagSuffix ? `${tagSuffix}·` : ""}AI角色${i + 1}`,
      ...preset
    };
  });
}
