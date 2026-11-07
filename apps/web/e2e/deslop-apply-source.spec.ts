import { test, expect, type Page, type Route } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

const original = "门外仿佛有人。他仿佛听见脚步。";
async function save(page: Page, id: string, content: string) {
  const base = (await (await page.request.get(`/api/chapters/${id}`)).json()).data;
  expect((await page.request.patch(`/api/chapters/${id}`, { data: { content, baseContentHash: base.contentHash } })).status()).toBe(200);
}
async function stored(page: Page, id: string) { return (await (await page.request.get(`/api/chapters/${id}`)).json()).data.content; }
async function setup(page: Page) {
  await warmUpAuthRoutes(page); const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  expect((await page.request.post("/api/auth/register", { data: { email: `deslop-apply-${stamp}@example.com`, password: "deslop-apply-test-pass", displayName: "扫描应用合成" } })).status()).toBe(201);
  const p = (await (await page.request.post("/api/projects", { data: { title: "扫描应用合成作品", slug: `deslop-apply-${stamp}` } })).json()).data;
  const a = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "扫描章甲" } })).json()).data;
  const b = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "扫描章乙" } })).json()).data;
  await save(page, a.id, original); await save(page, b.id, "乙章原稿。");
  await page.goto(`/projects/${p.id}/workspace`); await expect(page.locator(".editor-textarea")).toHaveValue(original);
  await page.getByRole("tab", { name: "去 AI 味", exact: true }).click();
  return { chapterId: a.id as string, otherId: b.id as string };
}
async function scan(page: Page) { await page.getByRole("button", { name: "扫描当前章节", exact: true }).click(); await expect(page.locator(".deslop-issues")).toBeVisible(); }
async function chooseSecond(page: Page) { await page.getByRole("button", { name: "应用", exact: true }).nth(1).click(); await page.getByPlaceholder("留空表示删除").fill("确实"); }

test("正文改动后旧扫描与确认失效，不能按旧位置替换", async ({ page }) => {
  const f = await setup(page); await scan(page); await chooseSecond(page);
  const newer = "新加前缀。" + original;
  await page.locator(".editor-textarea").fill(newer); await expect(page.locator(".save-status")).toHaveText("已保存");
  await expect(page.getByRole("button", { name: "确认应用", exact: true })).toHaveCount(0);
  await expect(page.locator(".deslop-issues")).toHaveCount(0); expect(await stored(page, f.chapterId)).toBe(newer);
});

test("应用前保存未存稿，重复片段只替换选中的第二处", async ({ page }) => {
  const f = await setup(page); const edited = original + "末尾作者补充。";
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH") await route.fulfill({ status: 503, json: { success: false } }); else await route.continue(); });
  await page.locator(".editor-textarea").fill(edited); await scan(page); await chooseSecond(page);
  await page.unroute(`**/api/chapters/${f.chapterId}`);
  const expected = edited.slice(0, edited.lastIndexOf("仿佛")) + "确实" + edited.slice(edited.lastIndexOf("仿佛") + 2);
  await page.getByRole("button", { name: "确认应用", exact: true }).click();
  await expect.poll(() => stored(page, f.chapterId)).toBe(expected);
  await expect(page.locator(".editor-textarea")).toHaveValue(expected);
  const versions = (await (await page.request.get(`/api/chapters/${f.chapterId}/versions`)).json()).data;
  expect(versions.some((v: { contentPreview: string }) => v.contentPreview === edited)).toBe(true);
});

test("保存失败时不发送应用且保留作者稿", async ({ page }) => {
  const f = await setup(page); let applies = 0;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH") await route.fulfill({ status: 503, json: { success: false } }); else await route.continue(); });
  await page.route(`**/api/chapters/${f.chapterId}/apply-deslop`, async route => { applies++; await route.continue(); });
  const edited = original + "尚未存稿。"; await page.locator(".editor-textarea").fill(edited); await scan(page); await chooseSecond(page);
  await page.getByRole("button", { name: "确认应用", exact: true }).click();
  await expect(page.locator(".resource-panel > .form-error")).toContainText("保存"); expect(applies).toBe(0);
  expect(await stored(page, f.chapterId)).toBe(original); await expect(page.locator(".editor-textarea")).toHaveValue(edited);
});

test("扫描在途改文或切章后迟到报告不显示", async ({ page }) => {
  await setup(page); let held: Route | null = null;
  await page.route("**/api/deslop-rules/scan", async route => { held = route; });
  await page.getByRole("button", { name: "扫描当前章节", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".editor-textarea").fill("新前缀。" + original); await held!.continue();
  await expect(page.locator(".deslop-issues")).toHaveCount(0);
  await expect(page.locator(".resource-panel > .form-error")).toContainText("重新扫描");
  held = null; await page.getByRole("button", { name: "扫描当前章节", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".chapter-item").filter({ hasText: "扫描章乙" }).click(); await expect(page.locator(".editor-textarea")).toHaveValue("乙章原稿。"); await held!.continue();
  await expect(page.locator(".deslop-issues")).toHaveCount(0);
});

test("扫描后远端更新应用409不覆盖新稿", async ({ page }) => {
  const f = await setup(page); await scan(page); await chooseSecond(page); await save(page, f.chapterId, "另一页面最新稿。");
  const response = page.waitForResponse(r => r.url().endsWith("/apply-deslop")); await page.getByRole("button", { name: "确认应用", exact: true }).click();
  expect((await response).status()).toBe(409); await expect(page.locator(".resource-panel > .form-error")).toContainText("重新扫描");
  expect(await stored(page, f.chapterId)).toBe("另一页面最新稿。");
});

test("应用已写库但确认丢失后同目标重试不重复版本", async ({ page }) => {
  const f = await setup(page); await scan(page); await chooseSecond(page); let first = true;
  await page.route(`**/api/chapters/${f.chapterId}/apply-deslop`, async route => { if (first) { first = false; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "确认应用", exact: true }).click(); await expect(page.locator(".resource-panel > .form-error")).toBeVisible();
  const expected = "门外仿佛有人。他确实听见脚步。";
  await expect.poll(() => stored(page, f.chapterId)).toBe(expected);
  const count = (await (await page.request.get(`/api/chapters/${f.chapterId}/versions`)).json()).data.length;
  await page.getByRole("button", { name: "确认应用", exact: true }).click(); await expect(page.locator(".editor-textarea")).toHaveValue(expected);
  expect((await (await page.request.get(`/api/chapters/${f.chapterId}/versions`)).json()).data.length).toBe(count);
});

test("应用在途新输入保留并提示冲突", async ({ page }) => {
  const f = await setup(page); await scan(page); await chooseSecond(page); let held: Route | null = null;
  await page.route(`**/api/chapters/${f.chapterId}/apply-deslop`, async route => { held = route; });
  await page.getByRole("button", { name: "确认应用", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".editor-textarea").fill("请求在途写的新稿。"); await held!.continue();
  await expect.poll(() => stored(page, f.chapterId)).toBe("门外仿佛有人。他确实听见脚步。");
  await expect(page.locator(".editor-textarea")).toHaveValue("请求在途写的新稿。"); await expect(page.locator(".external-update-notice")).toBeVisible();
});

test("等待保存继续输入撤销应用，切章后迟到应用不刷新新章", async ({ page }) => {
  const f = await setup(page); let heldSave: Route | null = null, applies = 0;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH" && !heldSave) heldSave = route; else await route.continue(); });
  await page.locator(".editor-textarea").fill(original + "未存。"); await scan(page); await chooseSecond(page);
  await page.route(`**/api/chapters/${f.chapterId}/apply-deslop`, async route => { applies++; await route.continue(); });
  await page.getByRole("button", { name: "确认应用", exact: true }).click(); await expect.poll(() => Boolean(heldSave)).toBe(true);
  await expect(page.locator(".deslop-apply-editor").getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(page.getByPlaceholder("留空表示删除")).toBeDisabled();
  await page.locator(".editor-textarea").fill(original + "后来输入。"); await heldSave!.continue();
  await expect(page.locator(".resource-panel > .form-error")).toContainText("正文"); expect(applies).toBe(0);
  await page.unroute(`**/api/chapters/${f.chapterId}`); await page.unroute(`**/api/chapters/${f.chapterId}/apply-deslop`);
  await scan(page); await chooseSecond(page); let heldApply: Route | null = null;
  await page.route(`**/api/chapters/${f.chapterId}/apply-deslop`, async route => { heldApply = route; });
  await page.getByRole("button", { name: "确认应用", exact: true }).click(); await expect.poll(() => Boolean(heldApply)).toBe(true);
  await page.locator(".chapter-item").filter({ hasText: "扫描章乙" }).click(); await expect(page.locator(".editor-textarea")).toHaveValue("乙章原稿。");
  await page.locator(".editor-textarea").fill("乙章独立编辑。"); await heldApply!.continue();
  await expect(page.locator(".editor-textarea")).toHaveValue("乙章独立编辑。"); await expect(page.locator(".deslop-issues")).toHaveCount(0);
});

test("扫描位置不匹配时拒绝应用，Unicode前缀保持正确定位", async ({ page }) => {
  const f = await setup(page); const edited = "😀前缀。" + original;
  await page.locator(".editor-textarea").fill(edited); await expect(page.locator(".save-status")).toHaveText("已保存");
  await page.route("**/api/deslop-rules/scan", async route => {
    await route.fulfill({ json: { success: true, data: { issues: [{ category: "weak_adverb", severity: "warning", matched: "仿佛", position: { start: 0, end: 2 }, suggestion: "合成错误位置" }], stats: { totalChars: edited.length, totalWords: edited.length, sentenceCount: 2, estimatedTokens: edited.length, avgSentenceLength: 8 }, appliedRuleCount: 0 } } });
  });
  await scan(page); await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.locator(".resource-panel > .form-error")).toContainText("位置与原文不一致");
  await expect(page.getByRole("button", { name: "确认应用", exact: true })).toHaveCount(0);
  expect(await stored(page, f.chapterId)).toBe(edited);
  await page.unroute("**/api/deslop-rules/scan"); await scan(page); await chooseSecond(page);
  await page.getByRole("button", { name: "确认应用", exact: true }).click();
  await expect(page.locator(".editor-textarea")).toHaveValue("😀前缀。门外仿佛有人。他确实听见脚步。");
});

test("真实应用HTTP验证JSON、身份、组织与大小写哈希幂等", async ({ page, playwright }) => {
  const f = await setup(page); const url = `/api/chapters/${f.chapterId}/apply-deslop`;
  const base = (await (await page.request.get(`/api/chapters/${f.chapterId}`)).json()).data;
  const body = { nextContent: "门外仿佛有人。他确实听见脚步。", baseContentHash: base.contentHash.toUpperCase(), matchedText: "仿佛" };
  expect((await page.request.post(url, { data: null })).status()).toBe(400);
  expect((await page.request.post(url, { data: "{", headers: { "Content-Type": "application/json" } })).status()).toBe(400);
  expect((await page.request.post(url, { data: [] })).status()).toBe(400);
  expect((await page.request.post(url, { data: { nextContent: "x" } })).status()).toBe(400);
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  const foreign = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    expect((await anonymous.post(url, { data: body })).status()).toBe(401);
    expect((await foreign.post("/api/auth/register", { data: { email: `apply-foreign-${Date.now()}@example.com`, password: "deslop-apply-test-pass", displayName: "异组织应用" } })).status()).toBe(201);
    expect((await foreign.post(url, { data: body })).status()).toBe(404);
    expect((await page.request.post(url, { data: body })).status()).toBe(200);
    const result = await page.request.post(url, { data: body }); expect(result.status()).toBe(200); expect((await result.json()).data.version).toBeNull();
  } finally { await anonymous.dispose(); await foreign.dispose(); }
});
