import { test, expect } from "@playwright/test";

/**
 * Settings 模型管理页 e2e
 *
 * 前置条件（与 smoke.spec.ts 一致）：
 *   1. PostgreSQL 跑在 127.0.0.1:5432
 *   2. apps/web/.env.local 含 SESSION_SECRET (>= 32 chars)
 *   3. .env 含 USE_FAKE_MODEL="true"
 *   4. pnpm db:seed 已跑过（含 1 个默认模型供应商 + 1 个默认模型档案）
 *   5. apps/worker 由 globalSetup 自动启动
 *
 * 注意：本 spec 不依赖 ENCRYPTION_KEY，因此跳过“新建模型供应商”分支
 * （供应商表单在未配 ENCRYPTION_KEY 时禁用 API 密钥 + 创建按钮）。
 * 供应商编辑/停用/连接测试用 seed 出的默认供应商走。
 */

const STAMP = Date.now();
const EMAIL = `e2e-settings-${STAMP}@example.com`;
const PASSWORD = "settings-test-pass";
const DISPLAY_NAME = `Settings用户${STAMP}`;

test("模型设置：banner / 测试连接 / 编辑供应商 / 档案 CRUD", async ({ page }) => {
  // 自动接受所有 confirm 弹窗（停用供应商、删除档案）
  page.on("dialog", (dialog) => void dialog.accept());

  // 1. 注册并登录
  await page.goto("/register");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="text"]').first().fill(DISPLAY_NAME);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "注册" }).click();
  await page.waitForURL("**/projects", { timeout: 15_000 });

  // 2. 进入设置页
  await page.getByRole("link", { name: "设置" }).click();
  await page.waitForURL("**/settings/models", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "模型设置" })).toBeVisible();

  // 3. Fake-model banner 应可见（USE_FAKE_MODEL=true 状态）
  const banner = page.locator(".settings-page").first();
  await expect(banner).toContainText(/演示模式|fake|USE_FAKE_MODEL/i);

  // 4. seed 默认供应商应在列表里
  await expect(page.getByRole("heading", { name: "模型供应商" })).toBeVisible();
  // 用标题锚定供应商卡：档案卡空状态提示「请先创建模型供应商…」含同名子串，
  // 若按整卡文本过滤会命中两张卡，触发 Playwright strict-mode 违例。
  const providersList = page
    .locator(".settings-card")
    .filter({ has: page.getByRole("heading", { name: "模型供应商" }) });
  await expect(providersList).not.toContainText("加载中");
  await expect(providersList.locator(".settings-list-item").first()).toBeVisible({ timeout: 10_000 });

  // 5. 测试连接（fake 模式 → 立即返回 OK）
  const firstProviderRow = providersList.locator(".settings-list-item").first();
  await firstProviderRow.getByRole("button", { name: "测试连接" }).click();
  await expect(firstProviderRow.locator(".settings-list-test.ok"))
    .toContainText(/连通成功|fake/i, { timeout: 15_000 });

  // 6. 编辑 seed 供应商（仅改名称，API 密钥在编辑模式始终 disabled）
  const renamedSuffix = ` · 改名${STAMP}`;
  await firstProviderRow.getByRole("button", { name: "编辑" }).click();
  const editDialog = page.locator(".settings-form").first();
  const nameInput = editDialog.locator('input[type="text"]').first();
  const originalName = (await nameInput.inputValue()).trim();
  await nameInput.fill(originalName + renamedSuffix);
  await editDialog.getByRole("button", { name: "保存" }).click();
  // 重命名后列表显示新名
  await expect(providersList).toContainText(originalName + renamedSuffix, { timeout: 10_000 });

  // 7. 模型档案列表区
  await expect(page.getByRole("heading", { name: "模型档案" })).toBeVisible();
  const profilesList = page.locator(".settings-card").filter({ hasText: "模型档案" });
  await expect(profilesList).not.toContainText("加载中");
  await expect(profilesList.locator(".settings-list-item").first()).toBeVisible({ timeout: 10_000 });

  // 8. 新建模型档案（绑定 seed 供应商，不需要 ENCRYPTION_KEY）
  const newProfileName = `E2E-Profile-${STAMP}`;
  await profilesList.getByRole("button", { name: "+ 新建档案" }).click();
  const profileDialog = page.locator(".settings-form").first();
  // 档案表单：select(供应商) → input(name) → input(modelName) → select(taskType) → 2x number
  const profileInputs = profileDialog.locator('input[type="text"]');
  await profileInputs.nth(0).fill(newProfileName);          // 档案名称
  await profileInputs.nth(1).fill("gpt-e2e-test");          // 模型 ID
  await profileDialog.getByRole("button", { name: "创建" }).click();

  await expect(profilesList).toContainText(newProfileName, { timeout: 10_000 });

  // 9. 编辑模型档案（改 modelName）
  const newProfileRow = profilesList.locator(".settings-list-item").filter({ hasText: newProfileName });
  await newProfileRow.getByRole("button", { name: "编辑" }).click();
  const editProfileDialog = page.locator(".settings-form").first();
  const editInputs = editProfileDialog.locator('input[type="text"]');
  await editInputs.nth(1).fill("gpt-e2e-renamed");
  await editProfileDialog.getByRole("button", { name: "保存" }).click();
  await expect(newProfileRow).toContainText("gpt-e2e-renamed", { timeout: 10_000 });

  // 10. 删除刚创建的模型档案
  await newProfileRow.getByRole("button", { name: "删除" }).click();
  await expect(profilesList).not.toContainText(newProfileName, { timeout: 10_000 });

  console.log(`✓ 模型设置 e2e 通过：用户=${EMAIL}`);
});
