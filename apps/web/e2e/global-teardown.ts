import { execSync } from "node:child_process";

/**
 * 关闭 globalSetup 启动的 worker 子进程。
 *
 * Windows 上 pnpm.cmd 会派生一个 cmd.exe → node.exe 进程树，
 * 仅 kill 顶层 PID 会留下 zombie node，所以用 taskkill /T 递归终止。
 */

export default async function globalTeardown(): Promise<void> {
  const pid = process.env.__WORKER_PID;
  if (!pid) return;

  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(Number(pid), "SIGTERM");
    }
    console.log(`[globalTeardown] worker stopped (pid=${pid})`);
  } catch (error) {
    console.warn(`[globalTeardown] failed to kill worker pid=${pid}:`, error);
  }
}
