import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 配置：仅启动 web 进程。worker 由跑测试前手动启动。
 *
 * 原因：worker 不监听端口，不适合 Playwright 的 webServer 健康检查；
 * 而且首次 e2e 只需保证 web 自动启动即可，worker 用 `pnpm --filter @ai-novel/worker dev`
 * 在另一个终端启动后保持运行即可。
 */
export default defineConfig({
  testDir: "./e2e",
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
