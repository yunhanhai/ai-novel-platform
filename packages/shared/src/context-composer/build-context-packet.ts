import type { ContextAsset, NormalizedContextOptions } from "./types";
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
  guideText: string;
  reviewCriteria?: string[];
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
  contextOptions?: NormalizedContextOptions;
}

interface PacketAssets {
  required: ContextAsset[];
  included: ContextAsset[];
  trimmed: ContextAsset[];
  available: ContextAsset[];
  excluded: ContextAsset[];
  forced: ContextAsset[];
  estimatedTokens: number;
  tokenBudget: number;
}

interface PacketResult {
  prompt: string;
  activationReport: ActivationReport;
  assets: PacketAssets;
  styleGuide?: StyleGuide;
  methodologyGuide?: MethodologyGuide;
}

export function buildContextPacket(input: PacketInput): PacketResult {
  const sections: string[] = [];
  const options = input.contextOptions ?? {
    budgetPreset: "standard",
    excludedAssetIds: [],
    forcedAssetIds: []
  };
  const excludedIds = new Set(options.excludedAssetIds);
  const forcedIds = new Set(options.forcedAssetIds);

  sections.push(`【作品】${input.projectTitle}`);
  if (input.styleBrief) {
    sections.push(`【风格】${input.styleBrief}`);
  }

  const requiredAssets = buildRequiredAssets(input);
  for (const asset of requiredAssets) {
    sections.push(asset.content);
  }

  sections.push("");
  sections.push(`【当前章节】第${input.currentChapter.chapterNo}章 ${input.currentChapter.title}`);
  if (input.currentChapter.outlineSummary) {
    sections.push(`章节目标：${input.currentChapter.outlineSummary}`);
  }

  const keywordSources = buildKeywordSources(input);
  const triggerText = [
    input.currentChapter.title,
    input.currentChapter.outlineSummary ?? "",
    input.recentMemories.map((memory) => memory.content).join(" ")
  ].join(" ");
  const activationReport = activateByKeywords({ sources: keywordSources, triggerText });
  const activatedIds = new Set(activationReport.activated.map((asset) => asset.id));

  const candidates = buildDefaultCandidates(input, activationReport);
  const allAssets = buildAllOptionalAssets(input, activationReport);
  const forcedAssets = allAssets.filter(
    (asset) => forcedIds.has(asset.id) && !candidates.some((candidate) => candidate.id === asset.id)
  );
  const selectedCandidates = [...candidates, ...forcedAssets];
  const excludedAssets = selectedCandidates.filter((asset) => !asset.required && excludedIds.has(asset.id));
  const budgetItems = selectedCandidates.filter((asset) => asset.required || !excludedIds.has(asset.id));

  const budget = input.tokenBudget - estimateTotalChars(sections);
  const budgetCapped = Math.max(100, budget);
  const budgetResult = applyTokenBudget({ items: budgetItems, tokenBudget: budgetCapped });

  for (const item of budgetResult.included) {
    sections.push("---");
    sections.push(item.content);
  }

  if (budgetResult.trimmed.length > 0) {
    sections.push("");
    sections.push(`【裁剪说明】由于上下文预算限制，以下 ${budgetResult.trimmed.length} 项未纳入：`);
    for (const item of budgetResult.trimmed) {
      sections.push(`  - ${item.id} (优先级 ${item.priority})`);
    }
  }

  return {
    prompt: sections.join("\n"),
    activationReport,
    assets: {
      required: requiredAssets,
      included: budgetResult.included,
      trimmed: budgetResult.trimmed,
      available: allAssets.filter(
        (asset) =>
          !activatedIds.has(asset.id) &&
          !budgetItems.some((item) => item.id === asset.id) &&
          !excludedIds.has(asset.id)
      ),
      excluded: excludedAssets,
      forced: forcedAssets,
      estimatedTokens: budgetResult.estimatedTokens,
      tokenBudget: budgetResult.tokenBudget
    },
    ...(input.styleGuide ? { styleGuide: input.styleGuide } : {}),
    ...(input.methodologyGuide ? { methodologyGuide: input.methodologyGuide } : {})
  };
}

function buildKeywordSources(input: PacketInput): KeywordSource[] {
  return [
    ...input.characters.map((character) => ({
      id: character.id,
      sourceType: "character" as const,
      name: character.name,
      content: formatCharacter(character),
      activationKeywords: [character.name],
      priority: input.currentChapter.outlineSummary?.includes(character.name) ? 15 : 8
    })),
    ...input.worldItems.map((worldItem) => ({
      id: worldItem.id,
      sourceType: "world_item" as const,
      name: worldItem.name,
      content: formatWorldItem(worldItem),
      activationKeywords: worldItem.activationKeywords,
      priority: worldItem.itemType === "artifact" || worldItem.itemType === "power_system" ? 7 : 4
    }))
  ];
}

function buildDefaultCandidates(input: PacketInput, activationReport: ActivationReport): ContextAsset[] {
  const activatedById = new Map(activationReport.activated.map((asset) => [asset.id, asset]));
  return [
    ...input.characters.map((character) => characterAsset(character, input, activatedById)),
    ...activationReport.activated
      .filter((asset) => asset.sourceType !== "character")
      .map((asset) => ({
        id: asset.id,
        sourceType: "world_item" as const,
        name: asset.name,
        content: asset.content,
        priority: asset.priority,
        reason: "keyword_match",
        matchedKeywords: asset.matchedKeywords,
        tokenEstimate: estimateTokens(asset.content)
      })),
    ...input.plotThreads
      .filter((thread) => thread.status === "planted" || thread.status === "progressing")
      .map((thread) => plotThreadAsset(thread)),
    ...input.recentMemories.map((memory, index) => memoryAsset(memory, index)),
    ...buildStyleBudgetItems(input.styleGuide),
    ...buildMethodologyBudgetItems(input.methodologyGuide)
  ];
}

function buildAllOptionalAssets(input: PacketInput, activationReport: ActivationReport): ContextAsset[] {
  const activatedById = new Map(activationReport.activated.map((asset) => [asset.id, asset]));
  return [
    ...input.characters.map((character) => characterAsset(character, input, activatedById)),
    ...input.worldItems.map((worldItem) => worldItemAsset(worldItem, activatedById)),
    ...input.plotThreads.map((thread) => plotThreadAsset(thread)),
    ...input.recentMemories.map((memory, index) => memoryAsset(memory, index)),
    ...buildStyleBudgetItems(input.styleGuide),
    ...buildMethodologyBudgetItems(input.methodologyGuide)
  ];
}

function buildRequiredAssets(input: PacketInput): ContextAsset[] {
  const assets: ContextAsset[] = [];
  if (input.styleGuide?.brief) {
    assets.push(requiredAsset("style-guide", "style", "style guide", `【风格画像】${input.styleGuide.brief}`));
  }
  if (input.styleGuide?.sentenceTarget) {
    const target = input.styleGuide.sentenceTarget;
    assets.push(requiredAsset("style-sentence-target", "style", "sentence target", `句长目标：平均 ${target.avg} 字（${target.min}-${target.max}）`));
  }
  if (input.methodologyGuide?.guideText) {
    assets.push(requiredAsset(
      "methodology-guide",
      "methodology",
      input.methodologyGuide.name,
      `【写作方法论】${input.methodologyGuide.name}\n${input.methodologyGuide.guideText}`
    ));
  }
  return assets;
}

function requiredAsset(
  id: string,
  sourceType: ContextAsset["sourceType"],
  name: string,
  content: string
): ContextAsset {
  return {
    id,
    sourceType,
    name,
    content,
    priority: 99,
    reason: "required",
    matchedKeywords: [],
    tokenEstimate: estimateTokens(content),
    required: true
  };
}

function characterAsset(
  character: CharacterInfo,
  input: PacketInput,
  activatedById: Map<string, { matchedKeywords: string[] }>
): ContextAsset {
  const content = formatCharacter(character);
  const activated = activatedById.get(character.id);
  const outlineMatched = input.currentChapter.outlineSummary?.includes(character.name) ?? false;
  return {
    id: character.id,
    sourceType: "character",
    name: character.name,
    content,
    priority: outlineMatched ? 15 : 6,
    reason: activated ? "keyword_match" : outlineMatched ? "chapter_outline" : "character_roster",
    matchedKeywords: activated?.matchedKeywords ?? (outlineMatched ? [character.name] : []),
    tokenEstimate: estimateTokens(content)
  };
}

function worldItemAsset(
  worldItem: WorldItemInfo,
  activatedById: Map<string, { matchedKeywords: string[] }>
): ContextAsset {
  const content = formatWorldItem(worldItem);
  const activated = activatedById.get(worldItem.id);
  return {
    id: worldItem.id,
    sourceType: "world_item",
    name: worldItem.name,
    content,
    priority: worldItem.itemType === "artifact" || worldItem.itemType === "power_system" ? 7 : 4,
    reason: activated ? "keyword_match" : "available_world_item",
    matchedKeywords: activated?.matchedKeywords ?? [],
    tokenEstimate: estimateTokens(content)
  };
}

function plotThreadAsset(thread: PlotThreadInfo): ContextAsset {
  const content = `【伏笔 - ${thread.threadType}】${thread.title}\n${thread.content}`;
  return {
    id: thread.id,
    sourceType: "plot_thread",
    name: thread.title,
    content,
    priority: thread.status === "planted" || thread.status === "progressing" ? 12 : 5,
    reason: thread.status === "planted" || thread.status === "progressing" ? `plot_thread_${thread.status}` : "available_plot_thread",
    matchedKeywords: [],
    tokenEstimate: estimateTokens(content)
  };
}

function memoryAsset(memory: MemoryInfo, index: number): ContextAsset {
  const content = `【最近摘要】${memory.content}`;
  return {
    id: `mem-${index}`,
    sourceType: "memory",
    name: `${memory.memoryType}:${index + 1}`,
    content,
    priority: 3,
    reason: "recent_memory",
    matchedKeywords: [],
    tokenEstimate: estimateTokens(content)
  };
}

function buildStyleBudgetItems(guide: StyleGuide | undefined): ContextAsset[] {
  if (!guide) return [];
  const items: ContextAsset[] = [];
  if (guide.banned && guide.banned.length > 0) {
    const content = `【禁用词】${guide.banned.join("、")}`;
    items.push({
      id: "style-banned",
      sourceType: "style",
      name: "banned words",
      content,
      priority: 14,
      reason: "active_style_profile",
      matchedKeywords: [],
      tokenEstimate: estimateTokens(content)
    });
  }
  if (guide.preferred && guide.preferred.length > 0) {
    const content = `【偏好词】${guide.preferred.join("、")}`;
    items.push({
      id: "style-preferred",
      sourceType: "style",
      name: "preferred words",
      content,
      priority: 9,
      reason: "active_style_profile",
      matchedKeywords: [],
      tokenEstimate: estimateTokens(content)
    });
  }
  return items;
}

function buildMethodologyBudgetItems(guide: MethodologyGuide | undefined): ContextAsset[] {
  if (!guide || !guide.reviewCriteria || guide.reviewCriteria.length === 0) return [];
  const content = `【方法论审查标准】\n${guide.reviewCriteria.map((criterion) => `- ${criterion}`).join("\n")}`;
  return [{
    id: "methodology-review",
    sourceType: "methodology",
    name: `${guide.name} review criteria`,
    content,
    priority: 13,
    reason: "active_methodology",
    matchedKeywords: [],
    tokenEstimate: estimateTokens(content)
  }];
}

function formatCharacter(character: CharacterInfo): string {
  let text = `【角色 - ${character.roleType}】${character.name}`;
  if (character.personality) text += `\n性格：${character.personality}`;
  if (character.speechPattern) text += `\n说话方式：${character.speechPattern}`;
  text += `\n${character.content}`;
  return text;
}

function formatWorldItem(worldItem: WorldItemInfo): string {
  return `【世界观 - ${worldItem.itemType}】${worldItem.name}\n${worldItem.content}`;
}

function estimateTotalChars(sections: string[]): number {
  return sections.reduce((sum, section) => sum + section.length, 0);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}
