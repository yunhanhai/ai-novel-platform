import { test, expect } from "@playwright/test";

/**
 * 完整核心闭环：注册 → 登录态进入项目列表 → 新建项目 → 进入工作台 →
 * 新建章节 → 触发 GENERATE_CHAPTER → 等 job SUCCEEDED → 校验章节正文已更新。
 *
 * 前置条件（人工保证，spec 不会自检）：
 *   1. PostgreSQL 跑在 127.0.0.1:5432
 *   2. apps/web/.env.local 含 SESSION_SECRET (>= 32 chars)
 *   3. .env 含 USE_FAKE_MODEL="true"
 *   4. apps/worker 已在另一个终端跑（spec 不会启动 worker）
 *   5. pnpm db:migrate + pnpm db:seed 已执行过
 */

const STAMP = Date.now();
const EMAIL = `e2e-${STAMP}@example.com`;
const PASSWORD = "e2etestpass123";
const DISPLAY_NAME = `E2E用户${STAMP}`;
const PROJECT_TITLE = `E2E 项目 ${STAMP}`;
const PROJECT_SLUG = `e2e-${STAMP}`;
const CHAPTER_TITLE = "首章 · 故事开端";

test("注册 → 创建项目 → 生成章节 完整闭环", async ({ page }) => {
  // 1. 注册
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "注册" })).toBeVisible();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="text"]').first().fill(DISPLAY_NAME);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "注册" }).click();

  // 2. 注册成功跳到 /projects
  await page.waitForURL("**/projects", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "我的作品" })).toBeVisible();
  // 顶栏显示用户名（session middleware 注入 → layout 读取）
  await expect(page.locator(".user-tag", { hasText: DISPLAY_NAME })).toBeVisible();

  // 3. 新建项目
  await page.getByRole("link", { name: "新建作品" }).click();
  await page.waitForURL("**/projects/new", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "新建作品" })).toBeVisible();
  const inputs = page.locator('input[type="text"]');
  await inputs.nth(0).fill(PROJECT_TITLE);   // 作品名称
  await inputs.nth(1).fill(PROJECT_SLUG);    // 标识符
  await inputs.nth(2).fill("奇幻");          // 题材
  await inputs.nth(3).fill("节奏紧凑");      // 风格简述
  await page.getByRole("button", { name: "创建" }).click();

  // 4. 跳转到 workspace（URL 应是 /projects/{id}/workspace，不是 /app/...）
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/workspace$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "章节目录" })).toBeVisible();

  // 5. 新建章节
  await page.getByRole("button", { name: "+ 新建" }).click();
  await page.getByPlaceholder("章节标题").fill(CHAPTER_TITLE);
  await page.getByRole("button", { name: "创建", exact: true }).click();

  // 章节出现在列表里且自动选中
  const chapterItem = page.locator(".chapter-item", { hasText: CHAPTER_TITLE });
  await expect(chapterItem).toBeVisible({ timeout: 10_000 });
  await expect(chapterItem).toHaveClass(/active/);

  // 6. 触发 GENERATE_CHAPTER（AI 面板默认是激活 tab）
  await expect(page.getByRole("heading", { name: "AI 助手" })).toBeVisible();
  await page.getByRole("button", { name: "生成章节" }).click();

  // 7. 等待 job 类型显示为 GENERATE_CHAPTER 且状态达到 SUCCEEDED
  //    （先等 type 切换，避免抓到上一轮残留状态）
  const jobTypeCell = page.locator(".job-status-card .job-status-row:has(.muted:text(\"类型\")) > span:not(.muted)");
  const jobStatusTag = page.locator(".tag-job").first();
  await expect(jobTypeCell).toHaveText("GENERATE_CHAPTER", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("SUCCEEDED", { timeout: 30_000 });

  // 8. 章节正文应已经被 worker 写回（fake-model 输出 > 0 字符）
  const editor = page.locator("textarea").first();
  await expect(editor).not.toBeEmpty({ timeout: 10_000 });

  // 9. 触发 DESLOP
  const deslopBtn = page.getByRole("button", { name: "去 AI 味" });
  await expect(deslopBtn).toBeEnabled({ timeout: 15_000 });
  await deslopBtn.click();
  await expect(jobTypeCell).toHaveText("DESLOP", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("SUCCEEDED", { timeout: 30_000 });

  // 10. 触发 EXTRACT_MEMORY
  const extractBtn = page.getByRole("button", { name: "抽取记忆" });
  await expect(extractBtn).toBeEnabled({ timeout: 15_000 });
  await extractBtn.click();
  await expect(jobTypeCell).toHaveText("EXTRACT_MEMORY", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("SUCCEEDED", { timeout: 30_000 });

  console.log(`✓ smoke 通过: 用户=${EMAIL} 项目=${PROJECT_TITLE}`);
});
