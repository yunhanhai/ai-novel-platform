import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const WEB_CWD = process.cwd();
const WORKER_CWD = join(WEB_CWD, "..", "worker");
const NEXT_CLI = join(dirname(require.resolve("next/package.json")), "dist", "bin", "next");
const TSX_CLI = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const READY_SIGNAL = "Worker started";
const WORKER_PID_PATTERN = /Worker started \[worker-(\d+)-/;
const LOG_DIR = join(WEB_CWD, "test-results");
const WEB_LOG = join(LOG_DIR, "web.log");
const WEB_ERR = join(LOG_DIR, "web.err.log");
const WORKER_LOG = join(LOG_DIR, "worker.log");
const WORKER_ERR = join(LOG_DIR, "worker.err.log");
const PID_FILE = join(LOG_DIR, "services.pid");
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;
const ROOT_URL = "http://127.0.0.1:3000";

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function writePid(pid: number | undefined, existing: string[] = []): void {
  const pids = [pid, ...existing.map((value) => Number(value))].filter((value) => Number.isFinite(value) && value > 0);
  writeFileSync(PID_FILE, [...new Set(pids)].join("\n"));
}

function readPidFile(): string[] {
  try {
    return readFileSync(PID_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((pid) => /^\d+$/.test(pid));
  } catch {
    return [];
  }
}

function readCombinedLog(): string {
  let text = "";
  for (const file of [WEB_LOG, WEB_ERR, WORKER_LOG, WORKER_ERR]) {
    try {
      text += readFileSync(file, "utf8");
    } catch {
      // Ignore missing files during startup.
    }
  }
  return text;
}

function stopProcessTree(pid: string): void {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(Number(pid), "SIGTERM");
    }
  } catch {
    // Best effort cleanup for failed startup.
  }
}

async function waitForWorkerReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const log = readCombinedLog();
    if (log.includes(READY_SIGNAL)) {
      const match = log.match(WORKER_PID_PATTERN);
      if (match?.[1]) {
        const pids = readPidFile();
        writePid(Number(match[1]), pids);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`worker did not print "${READY_SIGNAL}" within 30s\n--- worker log ---\n${readCombinedLog()}`);
}

async function waitForWebReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(ROOT_URL);
      if (response.ok) return;
    } catch {
      // Keep polling until the dev server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`web server did not become ready within 30s\n--- web log ---\n${readCombinedLog()}`);
}

function startDetached(command: string, args: string[], cwd: string, stdout: string, stderr: string): number {
  const outFd = openSync(stdout, "a");
  const errFd = openSync(stderr, "a");
  const child = spawn(process.execPath, [command, ...args], {
    cwd,
    stdio: ["ignore", outFd, errFd],
    env: process.env,
    detached: true,
    windowsHide: true
  });
  closeSync(outFd);
  closeSync(errFd);
  child.unref();
  return child.pid ?? 0;
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(WEB_LOG, "");
  writeFileSync(WEB_ERR, "");
  writeFileSync(WORKER_LOG, "");
  writeFileSync(WORKER_ERR, "");
  writeFileSync(PID_FILE, "");

  const webPid = startDetached(NEXT_CLI, ["dev"], WEB_CWD, WEB_LOG, WEB_ERR);
  const workerPid = startDetached(TSX_CLI, ["--env-file=../../.env", "src/index.ts"], WORKER_CWD, WORKER_LOG, WORKER_ERR);
  writePid(webPid, [String(workerPid)]);

  try {
    await Promise.all([waitForWebReady(), waitForWorkerReady()]);
  } catch (error) {
    for (const pid of readPidFile()) stopProcessTree(pid);
    throw error;
  }

  console.log(`[globalSetup] web pid=${webPid}, worker pid=${workerPid}`);
}
