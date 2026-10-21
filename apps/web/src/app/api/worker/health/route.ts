import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId, isUnauthorizedError } from "../../../../server/context";
import { sanitizeServerMessage } from "../../../../server/api-errors";

// worker 存活判定：超过 3 个轮询周期（至少 10 秒）没有心跳即视为离线。
function isOnline(lastSeenAt: Date, pollIntervalMs: number, now: number): boolean {
  const threshold = Math.max(pollIntervalMs * 3, 10_000);
  return now - lastSeenAt.getTime() <= threshold;
}

// 只回传最近仍可能有心跳的行。被强杀（SIGKILL）的 worker 来不及 unregister，
// 若不按时间窗过滤，健康面板会长期堆积"离线 worker"。
const HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

export async function GET() {
  try {
    // worker 是部署级共享进程（跨组织认领任务），因此这里不做组织过滤：
    // 任何登录用户都应能判断"本机有没有 worker 在跑"。
    await getOrganizationId();
    const workers = await prisma.workerHeartbeat.findMany({
      where: { lastSeenAt: { gte: new Date(Date.now() - HEARTBEAT_WINDOW_MS) } },
      orderBy: { lastSeenAt: "desc" },
      take: 10
    });

    const now = Date.now();
    const data = workers.map((worker) => ({
      lockKey: worker.lockKey,
      pid: worker.pid,
      startedAt: worker.startedAt.toISOString(),
      lastSeenAt: worker.lastSeenAt.toISOString(),
      pollIntervalMs: worker.pollIntervalMs,
      leaseDurationMs: worker.leaseDurationMs,
      lastTickStatus: worker.lastTickStatus,
      lastTickAt: worker.lastTickAt ? worker.lastTickAt.toISOString() : null,
      online: isOnline(worker.lastSeenAt, worker.pollIntervalMs, now)
    }));

    return NextResponse.json({
      success: true,
      data: {
        anyOnline: data.some((worker) => worker.online),
        workers: data
      }
    });
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ success: false, error: "未登录或会话已过期" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "服务异常";
    console.error("[api] worker/health failed", error);
    return NextResponse.json({ success: false, error: sanitizeServerMessage(message) }, { status: 500 });
  }
}
