import { test, expect } from "@playwright/test";

/**
 * Settings 模型管理页 e2e
 *
 * 前置条件（与 smoke.spec.ts 一致）：
 *   1. PostgreSQL 跑在 127.0.0.1:5432
 *   2. apps/web/.env.local 含 SESSION_SECRET (>= 32 chars)
 *   3. .env 含 USE_FAKE_MODEL="true"
 *   4. pnpm db:seed 已跑过（含 1 个默认 Provider + 1 个默认 Profile）
 *   5. apps/worker 由 globalSetup 自动启动
 *
 * 注意：本 spec 不依赖 ENCRYPTION_KEY，因此跳过"新建 Provider"分支
 * （ProviderForm 在未配 ENCRYPTION_KEY 时禁用 apiKey + 创建按钮）。
 * Provider 编辑/停用/连接测试用 seed 出的默认 Provider 走。
 */

const STAMP = Date.now();
const EMAIL = `e2e-settings-${STAMP}@example.com`;
const PASSWORD = "settings-test-pass";
const DISPLAY_NAME = `Settings用户${STAMP}`;

test("Settings 模型管理：banner / 测试连接 / 编辑 Provider / Profile CRUD", async ({ page }) => {
  // 自动接受所有 confirm 弹窗（停用 Provider、删除 Profile）
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

  // 4. seed 默认 Provider 应在列表里
  await expect(page.getByRole("heading", { name: "模型 Provider" })).toBeVisible();
  const providersList = page.locator(".settings-card").filter({ hasText: "模型 Provider" });
  await expect(providersList).not.toContainText("加载中");
  await expect(providersList.locator(".settings-list-item").first()).toBeVisible({ timeout: 10_000 });

  // 5. 测试连接（fake 模式 → 立即返回 OK）
  const firstProviderRow = providersList.locator(".settings-list-item").first();
  await firstProviderRow.getByRole("button", { name: "测试连接" }).click();
  await expect(firstProviderRow.locator(".settings-list-test.ok"))
    .toContainText(/连通成功|fake/i, { timeout: 15_000 });

  // 6. 编辑 seed Provider（仅改名称，apiKey 在编辑模式始终 disabled）
  const renamedSuffix = ` · 改名${STAMP}`;
  await firstProviderRow.getByRole("button", { name: "编辑" }).click();
  const editDialog = page.locator(".settings-form").first();
  const nameInput = editDialog.locator('input[type="text"]').first();
  const originalName = (await nameInput.inputValue()).trim();
  await nameInput.fill(originalName + renamedSuffix);
  await editDialog.getByRole("button", { name: "保存" }).click();
  // 重命名后列表显示新名
  await expect(providersList).toContainText(originalName + renamedSuffix, { timeout: 10_000 });

  // 7. Profile 列表区
  await expect(page.getByRole("heading", { name: "模型档案（Profile）" })).toBeVisible();
  const profilesList = page.locator(".settings-card").filter({ hasText: "模型档案" });
  await expect(profilesList).not.toContainText("加载中");
  await expect(profilesList.locator(".settings-list-item").first()).toBeVisible({ timeout: 10_000 });

  // 8. 新建 Profile（绑 seed Provider，不需要 ENCRYPTION_KEY）
  const newProfileName = `E2E-Profile-${STAMP}`;
  await profilesList.getByRole("button", { name: "+ 新建 Profile" }).click();
  const profileDialog = page.locator(".settings-form").first();
  // ProfileForm: select(Provider) → input(name) → input(modelName) → select(taskType) → 2x number
  const profileInputs = profileDialog.locator('input[type="text"]');
  await profileInputs.nth(0).fill(newProfileName);          // 档案名称
  await profileInputs.nth(1).fill("gpt-e2e-test");          // 模型 ID
  await profileDialog.getByRole("button", { name: "创建" }).click();

  await expect(profilesList).toContainText(newProfileName, { timeout: 10_000 });

  // 9. 编辑 Profile（改 modelName）
  const newProfileRow = profilesList.locator(".settings-list-item").filter({ hasText: newProfileName });
  await newProfileRow.getByRole("button", { name: "编辑" }).click();
  const editProfileDialog = page.locator(".settings-form").first();
  const editInputs = editProfileDialog.locator('input[type="text"]');
  await editInputs.nth(1).fill("gpt-e2e-renamed");
  await editProfileDialog.getByRole("button", { name: "保存" }).click();
  await expect(newProfileRow).toContainText("gpt-e2e-renamed", { timeout: 10_000 });

  // 10. 删除刚创建的 Profile
  await newProfileRow.getByRole("button", { name: "删除" }).click();
  await expect(profilesList).not.toContainText(newProfileName, { timeout: 10_000 });

  console.log(`✓ Settings 模型管理 e2e 通过：用户=${EMAIL}`);
});
