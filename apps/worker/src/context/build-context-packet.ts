import { activateByKeywords, type ActivationReport, type KeywordSource } from "./keyword-activation";
import { applyTokenBudget } from "./token-budget";

interface ChapterInfo {
  id: string;
  chapterNo: number;
  title: string;
  outlineSummary?: string;
}

interface CharacterInfo {
  id: string;
  name: string;
  roleType: string;
  personality?: string;
  speechPattern?: string;
  content: string;
}

interface WorldItemInfo {
  id: string;
  name: string;
  itemType: string;
  content: string;
  activationKeywords: string[];
}

interface PlotThreadInfo {
  id: string;
  threadType: string;
  title: string;
  content: string;
  status: string;
}

interface MemoryInfo {
  memoryType: string;
  content: string;
  scopeType: string;
  sourceChapterId?: string | null;
}

export interface StyleGuide {
  brief?: string;
  banned?: string[];
  preferred?: string[];
  sentenceTarget?: { avg: number; min: number; max: number };
}

export interface MethodologyGuide {
  name: string;
  methodType: string;
  guideText: string;        // 由 renderMethodologyGuide 渲染好的短文本
  reviewCriteria?: string[]; // 检查项清单，独立保留以便 review 步直接读
}

export interface PacketInput {
  projectId: string;
  projectTitle: string;
  styleBrief?: string;
  currentChapter: ChapterInfo;
  characters: CharacterInfo[];
  worldItems: WorldItemInfo[];
  plotThreads: PlotThreadInfo[];
  recentMemories: MemoryInfo[];
  tokenBudget: number;
  styleGuide?: StyleGuide;
  methodologyGuide?: MethodologyGuide;
}

interface PacketResult {
  prompt: string;
  activationReport: ActivationReport;
  styleGuide?: StyleGuide;
  methodologyGuide?: MethodologyGuide;
}

interface BudgetItem {
  id: string;
  content: string;
  priority: number;
}

export function buildContextPacket(input: PacketInput): PacketResult {
  const sections: string[] = [];

  // 1. 作品定位（必须，不计入预算）
  sections.push(`【作品】${input.projectTitle}`);
  if (input.styleBrief) {
    sections.push(`【风格】${input.styleBrief}`);
  }

  // 1b. 风格画像简要（必须，不计入预算）
  if (input.styleGuide?.brief) {
    sections.push(`【风格画像】${input.styleGuide.brief}`);
  }
  if (input.styleGuide?.sentenceTarget) {
    const t = input.styleGuide.sentenceTarget;
    sections.push(`句长目标：平均 ${t.avg} 字（${t.min}-${t.max}）`);
  }

  // 1c. 方法论指南（必须，不计入预算）
  if (input.methodologyGuide?.guideText) {
    sections.push(`【写作方法论】${input.methodologyGuide.name}`);
    sections.push(input.methodologyGuide.guideText);
  }

  // 2. 当前章节（必须）
  sections.push("");
  sections.push(
    `【当前章节】第${input.currentChapter.chapterNo}章 ${input.currentChapter.title}`
  );
  if (input.currentChapter.outlineSummary) {
    sections.push(`章节目标：${input.currentChapter.outlineSummary}`);
  }

  // 3. 组装可裁剪资产
  const keywordSources: KeywordSource[] = [
    ...input.characters.map((c) => ({
      id: c.id,
      sourceType: "character" as const,
      name: c.name,
      content: formatCharacter(c),
      activationKeywords: [c.name],
      priority: input.currentChapter.outlineSummary?.includes(c.name) ? 15 : 8
    })),
    ...input.worldItems.map((w) => ({
      id: w.id,
      sourceType: "world_item" as const,
      name: w.name,
      content: formatWorldItem(w),
      activationKeywords: w.activationKeywords,
      priority: w.itemType === "artifact" || w.itemType === "power_system" ? 7 : 4
    }))
  ];

  const triggerText = [
    input.currentChapter.title,
    input.currentChapter.outlineSummary ?? "",
    input.recentMemories.map((m) => m.content).join(" ")
  ].join(" ");

  const activationReport = activateByKeywords({ sources: keywordSources, triggerText });

  // 4. 添加伏笔（open plot threads，优先级高于一般资产）
  const openThreads = input.plotThreads.filter(
    (t) => t.status === "planted" || t.status === "progressing"
  );

  // 角色：当前章节提到的优先级提高，全部纳入候选
  const characterItems: BudgetItem[] = input.characters.map((c) => ({
    id: c.id,
    content: formatCharacter(c),
    priority: input.currentChapter.outlineSummary?.includes(c.name) ? 15 : 6
  }));

  const budgetItems: BudgetItem[] = [
    ...characterItems,
    ...activationReport.activated
      .filter((a) => a.sourceType !== "character") // 角色已单独处理
      .map((a) => ({
        id: a.id,
        content: a.content,
        priority: a.priority
      })),
    ...openThreads.map((t) => ({
      id: t.id,
      content: `【伏笔 - ${t.threadType}】${t.title}\n${t.content}`,
      priority: 12
    })),
    ...input.recentMemories.map((m, i) => ({
      id: `mem-${i}`,
      content: `【最近摘要】${m.content}`,
      priority: 3
    })),
    ...buildStyleBudgetItems(input.styleGuide),
    ...buildMethodologyBudgetItems(input.methodologyGuide)
  ];

  const budget = input.tokenBudget - estimateTotalChars(sections);
  const budgetCapped = Math.max(100, budget);
  const budgetResult = applyTokenBudget({ items: budgetItems, tokenBudget: budgetCapped });

  for (const item of budgetResult.included) {
    sections.push("---");
    sections.push(item.content);
  }

  if (budgetResult.trimmed.length > 0) {
    sections.push("");
    sections.push(
      `【裁剪说明】由于上下文预算限制，以下 ${budgetResult.trimmed.length} 项未纳入：`
    );
    for (const t of budgetResult.trimmed) {
      sections.push(`  - ${t.id} (优先级 ${t.priority})`);
    }
  }

  return {
    prompt: sections.join("\n"),
    activationReport,
    ...(input.styleGuide ? { styleGuide: input.styleGuide } : {}),
    ...(input.methodologyGuide ? { methodologyGuide: input.methodologyGuide } : {})
  };
}

// 风格 banned / preferred 列表注入为高优先级预算条目
function buildStyleBudgetItems(guide: StyleGuide | undefined): BudgetItem[] {
  if (!guide) return [];
  const items: BudgetItem[] = [];
  if (guide.banned && guide.banned.length > 0) {
    items.push({
      id: "style-banned",
      content: `【禁用词】${guide.banned.join("、")}`,
      priority: 14
    });
  }
  if (guide.preferred && guide.preferred.length > 0) {
    items.push({
      id: "style-preferred",
      content: `【偏好词】${guide.preferred.join("、")}`,
      priority: 9
    });
  }
  return items;
}

// 方法论审查标准也注入预算条目（仅 reviewCriteria，guideText 已在必选段中）
function buildMethodologyBudgetItems(guide: MethodologyGuide | undefined): BudgetItem[] {
  if (!guide || !guide.reviewCriteria || guide.reviewCriteria.length === 0) return [];
  return [{
    id: "methodology-review",
    content: `【方法论审查标准】\n${guide.reviewCriteria.map((c) => `- ${c}`).join("\n")}`,
    priority: 13
  }];
}

function formatCharacter(ch: CharacterInfo): string {
  let text = `【角色 - ${ch.roleType}】${ch.name}`;
  if (ch.personality) text += `\n性格：${ch.personality}`;
  if (ch.speechPattern) text += `\n说话方式：${ch.speechPattern}`;
  text += `\n${ch.content}`;
  return text;
}

function formatWorldItem(w: WorldItemInfo): string {
  return `【世界观 - ${w.itemType}】${w.name}\n${w.content}`;
}

function estimateTotalChars(sections: string[]): number {
  return sections.reduce((sum, s) => sum + s.length, 0);
}
