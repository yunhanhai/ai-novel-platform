import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PID_FILE = join(process.cwd(), "test-results", "services.pid");

/**
 * 关闭 globalSetup 启动的 worker 子进程。
 *
 * Windows 上 pnpm.cmd 会派生一个 cmd.exe → node.exe 进程树，
 * 仅 kill 顶层 PID 会留下 zombie node，所以用 taskkill /T 递归终止。
 */

export default async function globalTeardown(): Promise<void> {
  const filePids = (() => {
    try {
      return readFileSync(PID_FILE, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((pid) => /^\d+$/.test(pid));
    } catch {
      return [];
    }
  })();

  const pids = [...filePids, process.env.__WORKER_PID, process.env.__WORKER_SHELL_PID]
    .filter((pid): pid is string => Boolean(pid && /^\d+$/.test(pid)));
  if (pids.length === 0) return;

  for (const pid of [...new Set(pids)]) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(Number(pid), "SIGTERM");
      }
      console.log(`[globalTeardown] worker stopped (pid=${pid})`);
    } catch {
      // The shell wrapper can exit before teardown; the actual worker PID is the important one.
    }
  }
}
