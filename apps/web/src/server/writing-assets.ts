import type { PrismaClient } from "@ai-novel/db";

type PrismaJson = Parameters<PrismaClient["projectMemory"]["create"]>[0]["data"]["contentJson"];

// ========== 角色 ==========

interface CreateCharacterParams {
  organizationId: string;
  projectId: string;
  name: string;
  roleType: "protagonist" | "antagonist" | "supporting" | "minor";
  aliases?: string[];
  personality?: string;
  motivation?: string;
  speechPattern?: string;
  appearance?: string;
  knowledgeBoundary?: { knows: string[]; unknown: string[] };
  arc?: string;
  constraints?: string;
  createdById: string;
  prisma: PrismaClient;
}

export async function createCharacter(params: CreateCharacterParams) {
  const { organizationId, projectId, name, roleType, createdById, prisma, ...rest } = params;

  return prisma.character.create({
    data: {
      organizationId, projectId, name, roleType, createdById,
      ...(rest.aliases ? { aliases: rest.aliases } : {}),
      ...(rest.personality ? { personality: rest.personality } : {}),
      ...(rest.motivation ? { motivation: rest.motivation } : {}),
      ...(rest.speechPattern ? { speechPattern: rest.speechPattern } : {}),
      ...(rest.appearance ? { appearance: rest.appearance } : {}),
      ...(rest.knowledgeBoundary ? { knowledgeBoundary: rest.knowledgeBoundary } : {}),
      ...(rest.arc ? { arc: rest.arc } : {}),
      ...(rest.constraints ? { constraints: rest.constraints } : {})
    }
  });
}

export async function findCharactersByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.character.findMany({
    where: { organizationId, projectId, status: "active", deletedAt: null },
    orderBy: { createdAt: "asc" }
  });
}

interface UpdateCharacterInput {
  name?: string;
  aliases?: string[];
  roleType?: string;
  personality?: string;
  motivation?: string;
  speechPattern?: string;
  appearance?: string;
  knowledgeBoundary?: { knows: string[]; unknown: string[] };
  arc?: string;
  constraints?: string;
}

export async function updateCharacter(
  organizationId: string,
  characterId: string,
  data: UpdateCharacterInput,
  prisma: PrismaClient
) {
  return prisma.character.update({
    where: { id: characterId, organizationId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.aliases !== undefined ? { aliases: data.aliases } : {}),
      ...(data.roleType !== undefined ? { roleType: data.roleType } : {}),
      ...(data.personality !== undefined ? { personality: data.personality } : {}),
      ...(data.motivation !== undefined ? { motivation: data.motivation } : {}),
      ...(data.speechPattern !== undefined ? { speechPattern: data.speechPattern } : {}),
      ...(data.appearance !== undefined ? { appearance: data.appearance } : {}),
      ...(data.knowledgeBoundary !== undefined ? { knowledgeBoundary: data.knowledgeBoundary } : {}),
      ...(data.arc !== undefined ? { arc: data.arc } : {}),
      ...(data.constraints !== undefined ? { constraints: data.constraints } : {})
    }
  });
}

export async function deleteCharacter(organizationId: string, characterId: string, prisma: PrismaClient) {
  return prisma.character.update({
    where: { id: characterId, organizationId },
    data: { deletedAt: new Date() }
  });
}

// ========== 世界观 ==========

interface CreateWorldItemParams {
  organizationId: string;
  projectId: string;
  itemType: "location" | "faction" | "artifact" | "rule" | "power_system" | "timeline_event" | "creature" | "other";
  name: string;
  aliases?: string[];
  summary?: string;
  detail?: string;
  constraints?: string;
  activationKeywords?: string[];
  priority?: number;
  createdById: string;
  prisma: PrismaClient;
}

export async function createWorldItem(params: CreateWorldItemParams) {
  const { organizationId, projectId, itemType, name, createdById, prisma, ...rest } = params;

  return prisma.worldItem.create({
    data: {
      organizationId, projectId, itemType, name, createdById,
      priority: rest.priority ?? 0,
      ...(rest.aliases ? { aliases: rest.aliases } : {}),
      ...(rest.summary ? { summary: rest.summary } : {}),
      ...(rest.detail ? { detail: rest.detail } : {}),
      ...(rest.constraints ? { constraints: rest.constraints } : {}),
      ...(rest.activationKeywords ? { activationKeywords: rest.activationKeywords } : {})
    }
  });
}

export async function findWorldItemsByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.worldItem.findMany({
    where: { organizationId, projectId, status: "active", deletedAt: null },
    orderBy: { priority: "desc" }
  });
}

export async function findWorldItemsByKeywords(organizationId: string, projectId: string, keywords: string[], prisma: PrismaClient) {
  const items = await findWorldItemsByProject(organizationId, projectId, prisma);
  return items.filter((item) => {
    const kw = item.activationKeywords as string[] | null;
    if (!kw || !Array.isArray(kw)) return false;
    return kw.some((k: unknown) => typeof k === "string" && keywords.includes(k));
  });
}

interface UpdateWorldItemInput {
  name?: string;
  itemType?: string;
  aliases?: string[];
  summary?: string;
  detail?: string;
  constraints?: string;
  activationKeywords?: string[];
  priority?: number;
}

export async function updateWorldItem(
  organizationId: string,
  worldItemId: string,
  data: UpdateWorldItemInput,
  prisma: PrismaClient
) {
  return prisma.worldItem.update({
    where: { id: worldItemId, organizationId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.itemType !== undefined ? { itemType: data.itemType } : {}),
      ...(data.aliases !== undefined ? { aliases: data.aliases } : {}),
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
      ...(data.detail !== undefined ? { detail: data.detail } : {}),
      ...(data.constraints !== undefined ? { constraints: data.constraints } : {}),
      ...(data.activationKeywords !== undefined ? { activationKeywords: data.activationKeywords } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {})
    }
  });
}

export async function deleteWorldItem(organizationId: string, worldItemId: string, prisma: PrismaClient) {
  return prisma.worldItem.update({
    where: { id: worldItemId, organizationId },
    data: { deletedAt: new Date() }
  });
}

// ========== 伏笔 ==========

interface CreatePlotThreadParams {
  organizationId: string;
  projectId: string;
  threadType: "main" | "side" | "foreshadowing" | "mystery" | "conflict";
  title: string;
  description?: string;
  plantedChapterId?: string;
  expectedPayoffChapterId?: string;
  priority?: number;
  dependencies?: { thread_id: string; note?: string }[];
  createdById: string;
  prisma: PrismaClient;
}

export async function createPlotThread(params: CreatePlotThreadParams) {
  const { organizationId, projectId, threadType, title, createdById, prisma, ...rest } = params;

  return prisma.plotThread.create({
    data: {
      organizationId, projectId, threadType, title, createdById,
      priority: rest.priority ?? 0,
      ...(rest.description ? { description: rest.description } : {}),
      ...(rest.plantedChapterId ? { plantedChapterId: rest.plantedChapterId } : {}),
      ...(rest.expectedPayoffChapterId ? { expectedPayoffChapterId: rest.expectedPayoffChapterId } : {}),
      ...(rest.dependencies ? { dependencies: rest.dependencies } : {})
    }
  });
}

export async function findPlotThreadsByProject(organizationId: string, projectId: string, prisma: PrismaClient) {
  return prisma.plotThread.findMany({
    where: {
      organizationId, projectId, deletedAt: null,
      status: { in: ["planted", "progressing", "deferred"] }
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }]
  });
}

interface UpdatePlotThreadInput {
  title?: string;
  description?: string;
  threadType?: string;
  status?: "planted" | "progressing" | "deferred" | "resolved" | "abandoned";
  priority?: number;
  expectedPayoffChapterId?: string | null;
  resolvedChapterId?: string | null;
}

export async function updatePlotThread(
  organizationId: string,
  threadId: string,
  data: UpdatePlotThreadInput,
  prisma: PrismaClient
) {
  return prisma.plotThread.update({
    where: { id: threadId, organizationId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.threadType !== undefined ? { threadType: data.threadType } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.expectedPayoffChapterId !== undefined ? { expectedPayoffChapterId: data.expectedPayoffChapterId } : {}),
      ...(data.resolvedChapterId !== undefined ? { resolvedChapterId: data.resolvedChapterId } : {})
    }
  });
}

export async function deletePlotThread(organizationId: string, threadId: string, prisma: PrismaClient) {
  return prisma.plotThread.update({
    where: { id: threadId, organizationId },
    data: { deletedAt: new Date() }
  });
}

// ========== 项目记忆 ==========

interface CreateProjectMemoryParams {
  organizationId: string;
  projectId: string;
  memoryType: "chapter_summary" | "volume_summary" | "character_state" | "world_fact" | "hook_status" | "style_note" | "continuity_note";
  scopeType: "project" | "volume" | "chapter" | "character" | "world_item" | "plot_thread";
  scopeId?: string;
  content: string;
  contentJson?: PrismaJson;
  sourceChapterId?: string;
  sourceJobId?: string;
  confidence?: number;
  prisma: PrismaClient;
}

export async function createProjectMemory(params: CreateProjectMemoryParams) {
  const { organizationId, projectId, memoryType, scopeType, content, prisma, ...rest } = params;

  return prisma.projectMemory.create({
    data: {
      organizationId, projectId, memoryType, scopeType, content,
      status: "proposed",
      ...(rest.scopeId ? { scopeId: rest.scopeId } : {}),
      ...(rest.contentJson !== undefined ? { contentJson: rest.contentJson } : {}),
      ...(rest.sourceChapterId ? { sourceChapterId: rest.sourceChapterId } : {}),
      ...(rest.sourceJobId ? { sourceJobId: rest.sourceJobId } : {}),
      ...(rest.confidence !== undefined ? { confidence: rest.confidence } : {})
    }
  });
}

export async function findMemoriesByProject(
  organizationId: string,
  projectId: string,
  filters: { status?: "proposed" | "accepted" | "rejected" | "superseded"; memoryType?: string },
  prisma: PrismaClient
) {
  return prisma.projectMemory.findMany({
    where: {
      organizationId, projectId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.memoryType ? { memoryType: filters.memoryType } : {})
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function setMemoryStatus(
  organizationId: string,
  memoryId: string,
  status: "proposed" | "accepted" | "rejected" | "superseded",
  prisma: PrismaClient
) {
  return prisma.projectMemory.update({
    where: { id: memoryId, organizationId },
    data: {
      status,
      acceptedAt: status === "accepted" ? new Date() : null
    }
  });
}
