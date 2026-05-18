import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 配置：
 *   - Playwright 的 webServer 自动起 Next.js dev server
 *   - globalSetup 用 child_process 起 worker，等 "Worker started" 信号
 *   - globalTeardown 用 taskkill /T 递归终止 worker 进程树
 *
 * 跑法：`pnpm test:e2e`（或 `pnpm --filter @ai-novel/web test:e2e`）
 * 前置：PostgreSQL 已起、.env 配 USE_FAKE_MODEL=true、pnpm db:seed 跑过。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // 用完整 chromium 而非 headless_shell（headless_shell 在国内 CDN 下载常超时）
    launchOptions: {
      channel: "chromium"
    }
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium"
      }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe"
  }
});
