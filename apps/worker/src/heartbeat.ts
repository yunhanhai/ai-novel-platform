import type { PrismaClient } from "@ai-novel/db";
import type { TickResult } from "./poll";

// worker 存活心跳。写入 worker_heartbeats 表（lock_key 唯一），
// 供 /api/worker/health 判断"到底有没有 worker 在跑"——
// 任务长时间排队时，用户能立刻区分是 worker 没启动还是任务慢。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HeartbeatDeps {
  prisma: PrismaClient;
  lockKey: string;
  organizationId?: string | null;
  pollIntervalMs: number;
  leaseDurationMs: number;
  pid?: number;
}

export function createHeartbeat(deps: HeartbeatDeps) {
  const organizationId = deps.organizationId?.trim() ?? "";
  const enabled = UUID_RE.test(organizationId);
  const id = crypto.randomUUID();
  const startedAt = new Date();

  async function register(): Promise<void> {
    if (!enabled) {
      console.warn(
        "[heartbeat] DEFAULT_ORGANIZATION_ID 未配置或不是合法 UUID，跳过 worker 心跳（健康检查将显示无 worker）"
      );
      return;
    }

    // 清理被强杀进程留下的僵尸心跳行，避免健康面板长期堆积"离线 worker"。
    const staleBefore = new Date(Date.now() - 60 * 60 * 1000);
    await deps.prisma.workerHeartbeat.deleteMany({ where: { lastSeenAt: { lt: staleBefore } } });

    await deps.prisma.workerHeartbeat.upsert({
      where: { lockKey: deps.lockKey },
      create: {
        id,
        organizationId,
        lockKey: deps.lockKey,
        pid: deps.pid ?? process.pid,
        startedAt,
        lastSeenAt: startedAt,
        pollIntervalMs: deps.pollIntervalMs,
        leaseDurationMs: deps.leaseDurationMs,
        lastTickStatus: "starting",
        lastTickAt: startedAt
      },
      update: {
        lastSeenAt: startedAt,
        pollIntervalMs: deps.pollIntervalMs,
        leaseDurationMs: deps.leaseDurationMs
      }
    });
  }

  async function beat(status: TickResult): Promise<void> {
    if (!enabled) return;
    const now = new Date();
    await deps.prisma.workerHeartbeat.updateMany({
      where: { lockKey: deps.lockKey },
      data: { lastSeenAt: now, lastTickStatus: status, lastTickAt: now }
    });
  }

  async function unregister(): Promise<void> {
    if (!enabled) return;
    await deps.prisma.workerHeartbeat.deleteMany({ where: { lockKey: deps.lockKey } });
  }

  return { enabled, register, beat, unregister };
}

export type Heartbeat = ReturnType<typeof createHeartbeat>;
