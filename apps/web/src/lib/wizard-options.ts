import {
  listMethodologyTemplates,
  type MethodType
} from "@ai-novel/shared/methodology/templates";

export const METHODOLOGY_NONE = "none" as const;

export type ProjectType = "LONG_NOVEL" | "SHORT_STORY";

export interface GenreOption {
  value: string;
  label: string;
}

export interface StyleOption {
  value: string;
  label: string;
}

export interface ProjectTypeOption {
  value: ProjectType;
  label: string;
  description: string;
}

export interface MethodologyOption {
  value: MethodType | typeof METHODOLOGY_NONE;
  label: string;
  description: string;
}

export const GENRE_OPTIONS: readonly GenreOption[] = [
  { value: "fantasy", label: "奇幻" },
  { value: "xuanhuan", label: "玄幻" },
  { value: "xianxia", label: "仙侠" },
  { value: "wuxia", label: "武侠" },
  { value: "urban", label: "都市" },
  { value: "romance", label: "言情" },
  { value: "mystery", label: "悬疑" },
  { value: "detective", label: "推理" },
  { value: "scifi", label: "科幻" },
  { value: "apocalypse", label: "末日" },
  { value: "history", label: "历史" },
  { value: "military", label: "军事" },
  { value: "fanfiction", label: "同人" },
  { value: "youth", label: "青春" }
];

export const STYLE_OPTIONS: readonly StyleOption[] = [
  { value: "light_comedic", label: "轻松搞笑" },
  { value: "cold_restrained", label: "冷峻克制" },
  { value: "hot_blooded", label: "热血燃" },
  { value: "dark", label: "暗黑" },
  { value: "healing", label: "治愈" },
  { value: "first_person_casual", label: "第一人称口语化" },
  { value: "third_person_omniscient", label: "第三人称全知" },
  { value: "literary", label: "文学化" },
  { value: "webnovel_pace", label: "网文爽感" }
];

export const PROJECT_TYPE_OPTIONS: readonly ProjectTypeOption[] = [
  {
    value: "LONG_NOVEL",
    label: "长篇小说",
    description: "多卷多章长篇，适合连载与长线主线"
  },
  {
    value: "SHORT_STORY",
    label: "短篇故事",
    description: "单卷或短中篇，节奏紧凑、单线推进"
  }
];

export function getMethodologyOptions(): MethodologyOption[] {
  const templates = listMethodologyTemplates();
  const fromTemplates: MethodologyOption[] = templates.map((t) => ({
    value: t.methodType,
    label: t.name,
    description: t.description
  }));
  return [
    {
      value: METHODOLOGY_NONE,
      label: "暂不选择",
      description: "稍后在工作台的方法论面板补充"
    },
    ...fromTemplates,
    {
      value: "custom",
      label: "自定义",
      description: "先创建空方法论占位，稍后到工作台填写结构与审查规则"
    }
  ];
}

export function joinTags(tags: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.join(",");
}

export function splitTags(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
