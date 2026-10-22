import { test, expect } from "@playwright/test";

/**
 * 完整核心闭环：注册 → 登录态进入项目列表 → 新建项目 → 进入工作台 →
 * 新建章节 → 触发 GENERATE_CHAPTER → 等 job SUCCEEDED → 校验章节正文已更新。
 *
 * 前置条件（人工保证，spec 不会自检）：
 *   1. PostgreSQL 跑在 127.0.0.1:5432
 *   2. apps/web/.env.local 含 SESSION_SECRET (>= 32 chars)
 *   3. .env 含 USE_FAKE_MODEL="true"
 *   4. apps/worker 由 Playwright globalSetup 自动启动
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

  // 3. 新建项目（向导：Step 1 基础信息 → Step 2 题材风格 → 创建）
  await page.getByRole("link", { name: "新建作品" }).click();
  await page.waitForURL("**/projects/new", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "新建作品" })).toBeVisible();

  // Step 1：作品名称 / 标识符 / 类型（类型默认 LONG_NOVEL，跳过点击）
  const inputs = page.locator('input[type="text"]');
  await inputs.nth(0).fill(PROJECT_TITLE);
  await inputs.nth(1).fill(PROJECT_SLUG);
  await page.getByRole("button", { name: "下一步" }).click();

  // Step 2：选一个题材 + 一个风格 + 方法论
  await page.getByRole("checkbox", { name: "奇幻" }).click();
  await page.getByRole("checkbox", { name: "热血燃" }).click();
  await page.getByRole("radio", { name: "三幕式" }).click();
  await page.getByRole("button", { name: "下一步" }).click();

  // Step 3：故事梗概（跳过 AI 起草，留空进入下一步）
  await page.getByRole("button", { name: "下一步" }).click();

  // Step 4：大纲骨架（方法论自动预填，直接创建）
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

  // 6. 选择「均衡」质量模式并触发 GENERATE_CHAPTER（AI 面板默认是激活 tab）
  await expect(page.getByRole("heading", { name: "AI 助手" })).toBeVisible();
  await page.getByRole("radio", { name: "均衡" }).click();
  await page.getByRole("button", { name: "生成章节" }).click();

  // 7. 等待 job 类型显示为“生成章节”且状态达到“已完成”
  //    （先等 type 切换，避免抓到上一轮残留状态）
  const jobTypeCell = page.locator(".job-status-card .job-status-row:has(.muted:text(\"类型\")) > span:not(.muted)");
  const jobStatusTag = page.locator(".tag-job").first();
  await expect(jobTypeCell).toHaveText("生成章节", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("已完成", { timeout: 30_000 });

  // 8. 章节正文应已经被 worker 写回（fake-model 输出 > 0 字符）
  const editor = page.locator("textarea").first();
  await expect(editor).not.toBeEmpty({ timeout: 10_000 });

  // 8.5 选中全文 → 触发润色（POLISH）→ 应用结果（REWRITE/POLISH 闭环）
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator(".selection-toolbar")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "润色" }).click();
  await expect(jobTypeCell).toHaveText("润色", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("已完成", { timeout: 30_000 });
  await expect(page.locator(".rewrite-result-card")).toContainText("润色结果", { timeout: 10_000 });
  await page.getByRole("button", { name: "应用到编辑器" }).click();
  await expect(page.locator(".selection-toolbar")).toHaveCount(0);
  // fake-model 的输出含「林墨推开门」，应用后应出现在正文中
  await expect(editor).toHaveValue(/林墨推开门/, { timeout: 10_000 });

  // 8.6 继续写（CONTINUE_CHAPTER）：正文应追加变长
  const lengthBeforeContinue = (await editor.inputValue()).length;
  await page.getByRole("button", { name: "继续写" }).click();
  await expect(jobTypeCell).toHaveText("续写章节", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("已完成", { timeout: 30_000 });
  await expect
    .poll(async () => (await editor.inputValue()).length, { timeout: 15_000 })
    .toBeGreaterThan(lengthBeforeContinue);

  // 8.7 审校（REVIEW）：切到审校 tab 触发，等待结果面板出现
  //     job-status-card 只在 AI tab 渲染，因此这里以审校面板自身作为完成信号
  await page.getByRole("tab", { name: "审校" }).click();
  await page.getByRole("button", { name: "开始审校" }).click();
  await expect(page.locator(".review-summary")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "AI", exact: true }).click();

  // 8.8 大纲 tab：AI 批量生成细纲入口可用（fake 模型返回散文，应看到明确的失败提示而非崩溃）
  await page.getByRole("tab", { name: "大纲" }).click();
  await expect(page.locator(".outline-batch")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "生成细纲" }).click();
  await expect(page.locator(".outline-batch .form-error")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "AI", exact: true }).click();

  // 9. 触发 DESLOP
  //    先验证并发保护：输入未保存内容后触发 AI 任务，刷新回写不能吞掉本地输入
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  const localEditMarker = `本地未保存-${Date.now()}`;
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(localEditMarker);
  const deslopBtn = page.getByRole("button", { name: "去 AI 味" });
  await expect(deslopBtn).toBeEnabled({ timeout: 15_000 });
  await deslopBtn.click();
  await expect(jobTypeCell).toHaveText("去 AI 味", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("已完成", { timeout: 30_000 });
  // 本地未保存的输入必须仍在（未被任务回写覆盖）
  await expect(editor).toHaveValue(new RegExp(localEditMarker), { timeout: 10_000 });
  // 若检测到远端冲突，横幅应出现；选择保留本地
  const conflictBanner = page.locator(".external-update-notice");
  if (await conflictBanner.isVisible().catch(() => false)) {
    await conflictBanner.getByRole("button", { name: "保留本地" }).click();
  }

  // 10. 触发 EXTRACT_MEMORY
  const extractBtn = page.getByRole("button", { name: "抽取记忆" });
  await expect(extractBtn).toBeEnabled({ timeout: 15_000 });
  await extractBtn.click();
  await expect(jobTypeCell).toHaveText("抽取记忆", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("已完成", { timeout: 30_000 });

  // 11. 触发质量诊断（DIAGNOSE_CHAPTER，均衡模式）→ 异步诊断闭环
  const diagnoseBtn = page.getByRole("button", { name: "运行诊断" });
  await expect(diagnoseBtn).toBeEnabled({ timeout: 15_000 });
  await diagnoseBtn.click();
  await expect(jobTypeCell).toHaveText("质量诊断", { timeout: 10_000 });
  await expect(jobStatusTag).toHaveText("已完成", { timeout: 30_000 });
  // 诊断结果块渲染（性能摘要 + 诊断评分）
  await expect(page.locator(".diagnostic-summary")).toBeVisible({ timeout: 10_000 });

  // 12. 全书搜索：应命中已生成的正文并高亮关键词
  await page.getByLabel("搜索全书内容").fill("林墨");
  await expect(page.locator(".search-hit")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".search-hit-snippet mark").first()).toHaveText("林墨");
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(page.locator(".search-hit")).toHaveCount(0);

  // 12.5 版本对比：与当前正文比较，应展示差异或"一致"
  //     先预热路由（dev 模式首次请求会触发编译，可能返回 HTML 错误页）
  const chapterIdForDiff = await page.evaluate(async () => {
    const res = await fetch("/api/projects/" + location.pathname.split("/")[2] + "/chapters?page=1&pageSize=1");
    const json = await res.json();
    return json?.data?.items?.[0]?.id ?? null;
  });
  if (chapterIdForDiff) {
    await page.request.get(`/api/chapters/${chapterIdForDiff}/versions/diff?versionId=warmup`).catch(() => undefined);
  }
  await page.getByRole("tab", { name: "版本" }).click();
  await expect(page.locator(".version-card").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "对比当前" }).first().click();
  await expect(page.locator(".version-diff-summary")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "AI", exact: true }).click();

  // 12.6 统计 tab：KPI 与字数分布应渲染
  await page.getByRole("tab", { name: "统计" }).click();
  await expect(page.locator(".stats-kpi")).toHaveCount(3, { timeout: 15_000 });
  await expect(page.locator(".stats-bar-row")).toHaveCount(5);
  // 总字数必须反映真实正文（此前依赖章节数量变化才刷新，写作后仍显示 0）
  await expect
    .poll(
      async () => {
        const text = (await page.locator(".stats-kpi").nth(1).innerText()).replace(/[^\d]/g, "");
        return Number.parseInt(text || "0", 10);
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0);
  await page.getByRole("tab", { name: "AI", exact: true }).click();

  // 12.7 分卷：新建分卷后章节可移入，侧栏出现分组标题
  await page.getByRole("button", { name: "+ 卷" }).click();
  await page.getByPlaceholder("分卷标题（如：第一卷 风起）").fill("第一卷 风起");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".chapter-group-title").first()).toContainText("第一卷 风起", { timeout: 15_000 });
  await page.getByLabel(/移动到分卷/).first().selectOption({ label: "第一卷 风起" });
  await expect(page.locator(".chapter-group-title").first()).toContainText("第一卷 风起", { timeout: 15_000 });

  // 12.8 分卷改名与删除（删除后章节保留、回到未分卷）
  const volumeGroup = page.locator(".chapter-group").filter({ hasText: "第一卷 风起" }).first();
  await volumeGroup.hover();
  await volumeGroup.getByRole("button", { name: "改名" }).click();
  const volumeInput = page.locator(".chapter-group-edit input").first();
  await volumeInput.fill("第一卷 改名后");
  await volumeGroup.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".chapter-group-title").first()).toContainText("第一卷 改名后", {
    timeout: 15_000
  });

  const renamedGroup = page.locator(".chapter-group").filter({ hasText: "第一卷 改名后" }).first();
  await renamedGroup.hover();
  await renamedGroup.locator(".chapter-group-actions").getByRole("button", { name: "删除" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator(".chapter-group-title").filter({ hasText: "第一卷 改名后" })).toHaveCount(0, {
    timeout: 15_000
  });
  // 章节本身必须还在
  await expect(page.locator(".chapter-list-item").filter({ hasText: CHAPTER_TITLE })).toHaveCount(1);

  // 13. 导出作品（TXT 附件下载）
  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("link", { name: "导出" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.txt$/);

  // 13.5 离开保护：输入后立即刷新，未到防抖时间的改动不能丢
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  const guardMarker = `离开保护标记-${Date.now()}`;
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(guardMarker);
  // beforeunload 会弹出原生确认框，Playwright 需显式接受才继续导航
  page.once("dialog", (dialog) => void dialog.accept());
  // 不等待自动保存（默认 1500ms），立刻刷新模拟关页
  await page.reload();
  await expect(page.locator("textarea").first()).toHaveValue(new RegExp(guardMarker), {
    timeout: 20_000
  });

  // 14. 作品信息编辑：改梗概后保存，重载仍生效
  await page.getByRole("tab", { name: "作品", exact: true }).click();
  const premiseBox = page.getByPlaceholder(/主角、冲突、走向/);
  await expect(premiseBox).toBeVisible({ timeout: 15_000 });
  await premiseBox.fill("E2E 更新后的梗概：少年入京，卷入旧案。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存，后续生成会使用新的设定。")).toBeVisible({ timeout: 15_000 });

  // 15. 章节删除：删除后侧栏不再出现该章节
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  const chapterRow = page.locator(".chapter-list-item").filter({ hasText: CHAPTER_TITLE });
  await chapterRow.hover();
  await page.getByLabel(`删除章节「${CHAPTER_TITLE}」`).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator(".chapter-list-item").filter({ hasText: CHAPTER_TITLE })).toHaveCount(0, {
    timeout: 15_000
  });

  // 16. 窄屏布局：编辑器优先于侧栏，且出现「回到正文」快捷按钮
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const editorBox = await page.locator(".editor-textarea").boundingBox();
  const sidebarBox = await page.locator(".asset-sidebar").boundingBox();
  expect(editorBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(editorBox!.y).toBeLessThan(sidebarBox!.y);
  await expect(page.getByRole("button", { name: "回到正文" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  console.log(`✓ smoke 通过: 用户=${EMAIL} 项目=${PROJECT_TITLE}`);
});
