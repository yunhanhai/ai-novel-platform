import {
  appendExtraPrompt,
  extractJsonArray,
  generateAssetDrafts,
  type AssetDraftBaseContext,
  type AssetDraftBaseInput,
  type AssetDraftResult
} from "./asset-drafts";

const TASK_TYPE = "draft_plot_thread";

const THREAD_TYPES = [
  "main", "side", "foreshadowing", "mystery", "conflict"
] as const;
type ThreadType = (typeof THREAD_TYPES)[number];

export interface PlotThreadDraft {
  title: string;
  threadType: ThreadType;
  description: string;
  priority: number;
}

export interface PlotThreadDraftInput extends AssetDraftBaseInput {
  projectTitle?: string;
  genreTags?: string[];
  styleTags?: string[];
  premise?: string;
  focusType?: ThreadType;
  existingTitles?: string[];
}

export async function draftPlotThreads(
  input: PlotThreadDraftInput,
  ctx: AssetDraftBaseContext
): Promise<AssetDraftResult<PlotThreadDraft>> {
  return generateAssetDrafts<PlotThreadDraftInput, PlotThreadDraft>({
    input,
    ctx,
    taskType: TASK_TYPE,
    buildPrompt,
    parseResponse,
    buildFake
  });
}

function buildPrompt(input: PlotThreadDraftInput): string {
  const parts: string[] = [];
  parts.push(
    `你是剧情编剧。请为这部作品设计 ${input.count} 条${
      input.focusType ? `「${labelOfType(input.focusType)}」` : "伏笔/线索"
    }，每条要可以在后续章节回收。`
  );
  if (input.projectTitle) parts.push(`作品名：${input.projectTitle}`);
  if (input.genreTags?.length) parts.push(`题材：${input.genreTags.join("、")}`);
  if (input.styleTags?.length) parts.push(`风格：${input.styleTags.join("、")}`);
  if (input.premise) parts.push(`梗概：${input.premise}`);
  if (input.existingTitles?.length) {
    parts.push(`已有线索（避免重复）：${input.existingTitles.join("、")}`);
  }
  parts.push(
    [
      "请只输出 JSON 数组，不要 Markdown 或解释。每个元素结构：",
      "{",
      '  "title": string,                                          // 一句话标题',
      `  "threadType": ${THREAD_TYPES.map((t) => `"${t}"`).join("|")},`,
      '  "description": string,                                    // 埋设细节 + 预期回收方式',
      '  "priority": number                                        // 0-10'
    ].join("\n") + "\n}"
  );
  parts.push(appendExtraPrompt(input.extraPrompt).trim());
  return parts.filter(Boolean).join("\n");
}

function parseResponse(text: string): PlotThreadDraft[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  const out: PlotThreadDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) continue;
    out.push({
      title,
      threadType: isType(rec.threadType) ? rec.threadType : "foreshadowing",
      description: typeof rec.description === "string" ? rec.description.trim() : "",
      priority: clampPriority(rec.priority)
    });
  }
  return out;
}

function isType(value: unknown): value is ThreadType {
  return typeof value === "string" && (THREAD_TYPES as readonly string[]).includes(value);
}

function clampPriority(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.floor(n)));
}

function labelOfType(t: ThreadType): string {
  const map: Record<ThreadType, string> = {
    main: "主线",
    side: "支线",
    foreshadowing: "伏笔",
    mystery: "悬念",
    conflict: "冲突"
  };
  return map[t];
}

function buildFake(input: PlotThreadDraftInput): PlotThreadDraft[] {
  const presets: Array<Omit<PlotThreadDraft, "title">> = [
    {
      threadType: "foreshadowing",
      description: "在主角童年的一句台词中埋下，第三幕通过物件回收。",
      priority: 5
    },
    {
      threadType: "mystery",
      description: "围绕某个反派的身份，前期碎片化展示，中段揭示真相。",
      priority: 4
    },
    {
      threadType: "conflict",
      description: "两条势力的资源争夺，每隔几章升级一次。",
      priority: 3
    }
  ];
  return Array.from({ length: input.count }, (_, i) => {
    const preset = presets[i % presets.length]!;
    return { ...preset, title: `AI伏笔${i + 1}` };
  });
}
