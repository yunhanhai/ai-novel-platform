import type { PrismaClient } from "@ai-novel/db";
import type { GenerationJob } from "../poll";
import type { ExtractOutput } from "./extraction-output";
import {
  MAX_ACCEPTED_CHARACTER_STATES_PER_PROJECT,
  enforceCharacterStateQuota,
  isDuplicateContent,
  maintainChapterSummary,
  supersedeCharacterState
} from "./memory-maintenance";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function persistExtractedMemories(params: {
  tx: Tx;
  job: GenerationJob;
  chapter: { id: string; content: string };
  extracted: ExtractOutput;
}): Promise<void> {
  const { tx, job, chapter, extracted } = params;
  // Lock the same chapter row as editor saves until memory maintenance commits.
  const rows = await tx.$queryRaw<Array<{ id: string; content: string | null; title: string; chapterNo: number }>>`
    SELECT id, content, title, chapter_no AS "chapterNo" FROM chapters
    WHERE id = ${chapter.id}::uuid AND organization_id = ${job.organizationId}::uuid
      AND project_id = ${job.projectId}::uuid AND deleted_at IS NULL FOR UPDATE
  `;
  const source = rows[0];
  if (!source || source.content !== chapter.content) throw new Error("MEMORY_SOURCE_CHANGED: 章节正文已改变或不属于当前任务，记忆未写入");
  // 写入前先读取现有记忆，用于去重与维护
  const existingMemories = await tx.projectMemory.findMany({
    where: { organizationId: job.organizationId, projectId: job.projectId, status: { in: ["proposed", "accepted"] } },
    select: { content: true }
  });
  const existingContents = existingMemories.map((m) => m.content);
  const maintenance = { tx, organizationId: job.organizationId, projectId: job.projectId, chapterId: chapter.id };

  // 写入 proposed 状态的记忆
  for (const change of extracted.characterChanges) {
    if (!change.characterName) continue;
    const content = `${change.characterName}: ${change.change}`;
    if (isDuplicateContent(existingContents, content)) continue;
    // 角色状态只需反映最新：先淘汰该角色的更早状态
    await supersedeCharacterState({ ...maintenance, characterName: change.characterName });
    await tx.projectMemory.create({
      data: {
        organizationId: job.organizationId,
        projectId: job.projectId,
        memoryType: "character_state",
        scopeType: "chapter",
        scopeId: chapter.id,
        content,
        sourceChapterId: chapter.id,
        sourceJobId: job.id,
        status: "proposed",
        confidence: 70
      }
    });
    existingContents.push(content);
  }

  for (const fact of extracted.worldFacts) {
    if (!fact.fact) continue;
    if (isDuplicateContent(existingContents, fact.fact)) continue;
    await tx.projectMemory.create({
      data: {
        organizationId: job.organizationId,
        projectId: job.projectId,
        memoryType: "world_fact",
        scopeType: "chapter",
        scopeId: chapter.id,
        content: fact.fact,
        sourceChapterId: chapter.id,
        sourceJobId: job.id,
        status: "proposed",
        confidence: 70
      }
    });
    existingContents.push(fact.fact);
  }

  for (const hook of extracted.newHooks) {
    if (!hook.hook) continue;
    const content = `[新伏笔] ${hook.hook}`;
    if (isDuplicateContent(existingContents, content)) continue;
    await tx.projectMemory.create({
      data: {
        organizationId: job.organizationId,
        projectId: job.projectId,
        memoryType: "hook_status",
        scopeType: "chapter",
        scopeId: chapter.id,
        content,
        sourceChapterId: chapter.id,
        sourceJobId: job.id,
        status: "proposed",
        confidence: 60
      }
    });
    existingContents.push(content);
  }

  if (extracted.chapterSummary) {
    // 沿用章节摘要自动 accepted 的策略；此状态不表示已经人工核验语义。
    // 生成只读 accepted，同时淘汰同章旧摘要，避免上下文重复。
    await maintainChapterSummary(maintenance);
    await tx.projectMemory.create({
      data: {
        organizationId: job.organizationId,
        projectId: job.projectId,
        memoryType: "chapter_summary",
        scopeType: "chapter",
        scopeId: chapter.id,
        content: extracted.chapterSummary,
        contentJson: { title: source.title, chapterNo: source.chapterNo },
        sourceChapterId: chapter.id,
        sourceJobId: job.id,
        status: "accepted",
        confidence: 85
      }
    });
  }

  // accepted 的角色状态超过上限时淘汰最旧的，防止上下文预算被旧状态挤占
  const evictIds = await enforceCharacterStateQuota({
    ...maintenance,
    keep: MAX_ACCEPTED_CHARACTER_STATES_PER_PROJECT
  });
  if (evictIds.length > 0) {
    await tx.projectMemory.updateMany({
      where: { id: { in: evictIds } },
      data: { status: "superseded" }
    });
  }
}
