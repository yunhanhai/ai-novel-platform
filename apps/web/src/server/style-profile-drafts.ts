import {
  appendExtraPrompt,
  extractJsonArray,
  generateAssetDrafts,
  type AssetDraftBaseContext,
  type AssetDraftBaseInput,
  type AssetDraftResult
} from "./asset-drafts";

const TASK_TYPE = "draft_style_profile";

export interface StyleProfileDraft {
  name: string;
  styleBrief: string;
  bannedWords: string[];
  preferredWords: string[];
  rhythmNotes: string;
}

export interface StyleProfileDraftInput extends AssetDraftBaseInput {
  projectTitle?: string;
  genreTags?: string[];
  styleTags?: string[];
  premise?: string;
}

export async function draftStyleProfiles(
  input: StyleProfileDraftInput,
  ctx: AssetDraftBaseContext
): Promise<AssetDraftResult<StyleProfileDraft>> {
  return generateAssetDrafts<StyleProfileDraftInput, StyleProfileDraft>({
    input,
    ctx,
    taskType: TASK_TYPE,
    buildPrompt,
    parseResponse,
    buildFake
  });
}

function buildPrompt(input: StyleProfileDraftInput): string {
  const parts: string[] = [];
  parts.push(
    `你是文风顾问。请为这部作品生成 ${input.count} 套风格画像方案（如：庄重克制 / 鲜活口语 / 古典文白）。`
  );
  if (input.projectTitle) parts.push(`作品名：${input.projectTitle}`);
  if (input.genreTags?.length) parts.push(`题材：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`已选风格基调：${input.styleTags.join("、")}`);
  if (input.premise) parts.push(`梗概：${input.premise}`);
  parts.push(
    [
      "请只输出 JSON 数组，不要 Markdown 或解释。每个元素结构：",
      "{",
      '  "name": string,                                       // 风格名',
      '  "styleBrief": string,                                 // 一句话概括笔法',
      '  "bannedWords": string[],                              // 5-15 个禁用词（套话/口水词）',
      '  "preferredWords": string[],                           // 5-15 个偏好词',
      '  "rhythmNotes": string                                 // 节奏与句长建议'
    ].join("\n") + "\n}"
  );
  parts.push(appendExtraPrompt(input.extraPrompt).trim());
  return parts.filter(Boolean).join("\n");
}

function parseResponse(text: string): StyleProfileDraft[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  const out: StyleProfileDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      styleBrief: typeof rec.styleBrief === "string" ? rec.styleBrief.trim() : "",
      bannedWords: toStrArr(rec.bannedWords, 30),
      preferredWords: toStrArr(rec.preferredWords, 30),
      rhythmNotes: typeof rec.rhythmNotes === "string" ? rec.rhythmNotes.trim() : ""
    });
  }
  return out;
}

function toStrArr(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

function buildFake(input: StyleProfileDraftInput): StyleProfileDraft[] {
  const presets: Array<Omit<StyleProfileDraft, "name">> = [
    {
      styleBrief: "冷峻克制，少用形容词，节奏紧凑",
      bannedWords: ["仿佛", "似乎", "彷佛", "居然", "竟然", "略带", "微微"],
      preferredWords: ["决然", "倏地", "凝视", "未应", "扣紧", "侧身"],
      rhythmNotes: "短句为主，单句不超 25 字；对白比例约 30%"
    },
    {
      styleBrief: "鲜活口语，第一人称内心戏多",
      bannedWords: ["实在是", "毋庸置疑", "无可厚非", "由衷地"],
      preferredWords: ["怔住", "皱眉", "笑了", "抬手", "回敬"],
      rhythmNotes: "长短句交替；对白比例约 50%"
    },
    {
      styleBrief: "古典文白杂糅，借鉴章回体节奏",
      bannedWords: ["仿佛", "突然", "感觉"],
      preferredWords: ["乃", "竟", "遂", "翻身", "拱手"],
      rhythmNotes: "段首点题，章末留白；对白比例约 25%"
    }
  ];
  return Array.from({ length: input.count }, (_, i) => {
    const preset = presets[i % presets.length]!;
    return { ...preset, name: `AI风格方案${i + 1}` };
  });
}
