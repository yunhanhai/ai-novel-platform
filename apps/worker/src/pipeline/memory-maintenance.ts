// 记忆维护策略：对抗「连写数十章后记忆库膨胀、上下文被旧记忆挤占」的质量衰减。
// （同类开源项目的最高频质量抱怨——写 30+ 章后人名漂移、AI 味变重。）
//
// 三条规则，全部在 extract-memory 的落库事务内执行：
//   1. 章节摘要是事实性低风险内容 → 直接写为 accepted（无需用户逐条审），
//      同时把同章的旧摘要标为 superseded（重生成时替换）；
//   2. 角色状态应反映最新 → 写入同一角色的新状态时，把该角色更早的
//      character_state（含 accepted）标为 superseded；
//   3. accepted 的 character_state 超过保留上限时，按 createdAt 淘汰最旧的。

export const MAX_ACCEPTED_CHARACTER_STATES_PER_PROJECT = 100;

// 维护函数只依赖 projectMemory 的两个操作；用泛型让它兼容
// Prisma 事务对象与测试 mock，避免手写镜像类型。
interface MemoryStore {
  findMany: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<unknown>;
}

interface MaintenanceParams {
  tx: { projectMemory: unknown };
  organizationId: string;
  projectId: string;
  chapterId: string;
}

function storeOf(tx: { projectMemory: unknown }): MemoryStore {
  return tx.projectMemory as MemoryStore;
}

export async function maintainChapterSummary(params: MaintenanceParams): Promise<void> {
  const { organizationId, projectId, chapterId } = params;
  // 同章旧摘要（含旧 accepted）全部淘汰，避免重复条目
  await storeOf(params.tx).updateMany({
    where: {
      organizationId,
      projectId,
      memoryType: "chapter_summary",
      scopeId: chapterId
    },
    data: { status: "superseded" }
  });
}

export async function supersedeCharacterState(
  params: MaintenanceParams & { characterName: string }
): Promise<void> {
  const { organizationId, projectId, characterName } = params;
  // 淘汰该角色更早的所有状态（含 accepted）——状态只需反映最新
  await storeOf(params.tx).updateMany({
    where: {
      organizationId,
      projectId,
      memoryType: "character_state",
      status: { in: ["proposed", "accepted"] },
      content: { startsWith: `${characterName}: ` }
    },
    data: { status: "superseded" }
  });
}

// 去重：同内容（忽略首尾空白）的记忆已存在则跳过创建。
export function isDuplicateContent(existing: string[], content: string): boolean {
  const normalized = content.trim();
  return existing.some((item) => item.trim() === normalized);
}

// accepted 的角色状态超过上限时，返回应淘汰的最旧记录 id 列表。
export async function enforceCharacterStateQuota(
  params: MaintenanceParams & { keep: number }
): Promise<string[]> {
  const { organizationId, projectId, keep } = params;
  const rows = (await storeOf(params.tx).findMany({
    where: {
      organizationId,
      projectId,
      memoryType: "character_state",
      status: "accepted"
    },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  })) as Array<{ id: string }>;

  if (rows.length <= keep) return [];
  return rows.slice(0, rows.length - keep).map((row) => row.id);
}
