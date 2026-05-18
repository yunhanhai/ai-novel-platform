import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 启动 worker 子进程并等待其打印 "Worker started"，作为 Playwright globalSetup。
 * 进程引用通过 process.env.__WORKER_PID 透传给 globalTeardown。
 *
 * 失败处理：若 30s 内未看到就绪信号，抛错让 Playwright 中止整轮测试。
 */

const WORKER_CWD = join(process.cwd(), "..", "worker");
const READY_SIGNAL = "Worker started";
const LOG_DIR = join(process.cwd(), "test-results");
const LOG_FILE = join(LOG_DIR, "worker.log");

async function waitForWorkerReady(child: ChildProcess): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  const chunks: string[] = [];

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`worker 未在 30s 内打印 "${READY_SIGNAL}"\n--- worker 日志 ---\n${chunks.join("")}`));
    }, 30_000);

    const onChunk = (data: Buffer | string) => {
      const text = data.toString();
      chunks.push(text);
      if (text.includes(READY_SIGNAL)) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("exit", (code) => {
      clearTimeout(timer);
      writeFileSync(LOG_FILE, chunks.join(""));
      reject(new Error(`worker 异常退出 (code=${code})，日志见 ${LOG_FILE}`));
    });
  });
}

export default async function globalSetup(): Promise<void> {
  const isWindows = process.platform === "win32";
  const child = spawn("pnpm", ["dev"], {
    cwd: WORKER_CWD,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: isWindows, // Windows 上 pnpm.cmd 需要走 shell 解析
    windowsHide: true
  });

  try {
    await waitForWorkerReady(child);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }

  // 透传 PID 给 teardown 用
  process.env.__WORKER_PID = String(child.pid);
  // 让子进程脱离父进程（unref），避免 Playwright 退出时被吊死
  child.unref();
  console.log(`[globalSetup] worker started (pid=${child.pid})`);
}
