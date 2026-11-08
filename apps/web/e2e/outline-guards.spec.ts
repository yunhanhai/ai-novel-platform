import { test, expect, type Page, type Route } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

async function setup(page: Page) {
  await warmUpAuthRoutes(page); const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  expect((await page.request.post("/api/auth/register", { data: { email: `outline-${stamp}@example.com`, password: "outline-test-pass", displayName: "细纲合成验收" } })).status()).toBe(201);
  const p = (await (await page.request.post("/api/projects", { data: { title: "细纲合成作品", slug: `outline-${stamp}` } })).json()).data;
  const c = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "细纲合成章" } })).json()).data;
  const base = (await (await page.request.get(`/api/chapters/${c.id}`)).json()).data;
  expect((await page.request.patch(`/api/chapters/${c.id}`, { data: { content: "作者原有正文。", baseContentHash: base.contentHash } })).status()).toBe(200);
  const outline = await page.request.post("/api/outlines", { data: { projectId: p.id, level: "CHAPTER", title: "作者原细纲", summary: "作者保留摘要", orderIndex: 1 } }); expect(outline.status()).toBe(201);
  const item = (await outline.json()).data;
  await page.goto(`/projects/${p.id}/workspace`); await expect(page.locator(".editor-textarea")).toHaveValue("作者原有正文。");
  return { projectId: p.id as string, chapterId: c.id as string, outlineId: item.id as string };
}
async function open(page: Page) { await page.getByRole("tab", { name: "大纲", exact: true }).click(); }

test("大纲加载失败可见并能重试读取真实条目", async ({ page }) => {
  await setup(page); let failed = true;
  await page.route("**/api/outlines?*", async route => { if (failed) await route.fulfill({ status: 503, json: { success: false, error: "合成大纲加载失败" } }); else await route.continue(); });
  await open(page); await expect(page.locator(".resource-panel > .form-error")).toContainText("合成大纲加载失败");
  failed = false; await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".resource-card-header")).toContainText("作者原细纲");
});

test("等待正文保存时改文撤销细纲任务提交", async ({ page }) => {
  const f = await setup(page); await open(page); let held: Route | null = null, submitted = 0;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH" && !held) held = route; else await route.continue(); });
  await page.route("**/api/generation-jobs", async route => { submitted++; await route.fulfill({ status: 400, json: { success: false } }); });
  await page.locator(".editor-textarea").fill("第一次未存稿。"); await page.getByRole("button", { name: "生成细纲", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true); await page.locator(".editor-textarea").fill("等待中后输入稿。"); await held!.continue();
  await expect(page.getByRole("alert", { name: "细纲准备提示" })).toContainText("正文"); expect(submitted).toBe(0);
});

test("成功生成刷新当前项目大纲且不刷新章节正文", async ({ page }) => {
  const f = await setup(page); await open(page); await expect(page.locator(".resource-card-header")).toContainText("作者原细纲"); let reads = 0;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "GET") reads++; await route.continue(); });
  await page.route("**/api/generation-jobs", async route => {
    expect((await page.request.post("/api/outlines", { data: { projectId: f.projectId, level: "CHAPTER", title: "合成生成细纲", summary: "合成新摘要", orderIndex: 2 } })).status()).toBe(201);
    await route.fulfill({ status: 201, json: { success: true, data: { id: "55555555-5555-4555-8555-555555555555", jobType: "GENERATE_OUTLINE", status: "SUCCEEDED", output: { projectId: f.projectId, createdCount: 1, requestedCount: 1 } } } });
  });
  await page.getByRole("button", { name: "生成细纲", exact: true }).click();
  await expect(page.locator(".resource-card-header").filter({ hasText: "合成生成细纲" })).toBeVisible(); expect(reads).toBe(0);
  await expect(page.locator(".resource-card-header").filter({ hasText: "作者原细纲" })).toBeVisible();
});

test("更新大纲可清空摘要，保存等待时表单不能被继续改写", async ({ page }) => {
  const f = await setup(page); await open(page); const card = page.locator(".resource-card").filter({ hasText: "作者原细纲" });
  await card.getByRole("button", { name: "编辑", exact: true }).click(); await page.locator(".resource-form textarea").fill("");
  let held: Route | null = null;
  await page.route(`**/api/outlines/${f.outlineId}`, async route => { held = route; });
  await page.getByRole("button", { name: "更新", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await expect(page.locator(".resource-form input")).toBeDisabled(); await expect(page.locator(".resource-form textarea")).toBeDisabled();
  await held!.continue(); await expect(page.locator(".resource-form")).toHaveCount(0);
  const rows = (await (await page.request.get(`/api/outlines?projectId=${f.projectId}`)).json()).data;
  expect(rows.find((row: { id: string }) => row.id === f.outlineId).summary).toBe("");
});

test("迟到列表不能覆盖新列表，卸载后不更新新面板", async ({ page }) => {
  const f = await setup(page); let held: Route | null = null;
  await page.route("**/api/outlines?*", async route => { if (!held) held = route; else await route.continue(); });
  await open(page); await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await expect(page.locator(".resource-card-header")).toContainText("作者原细纲");
  await held!.fulfill({ json: { success: true, data: [] } }); await expect(page.locator(".resource-card-header")).toContainText("作者原细纲");
  await page.unroute("**/api/outlines?*"); held = null;
  await page.route("**/api/outlines?*", async route => { held = route; });
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole("tab", { name: "AI", exact: true }).click(); await held!.fulfill({ json: { success: true, data: [] } });
  await expect(page.locator(".outline-batch")).toHaveCount(0); await page.unroute("**/api/outlines?*"); await open(page);
  await expect(page.locator(".resource-card-header")).toContainText("作者原细纲");
});

test("真实大纲HTTP校验输入和父级项目范围，异组织更新不能写入", async ({ page, playwright }) => {
  const f = await setup(page); const url = `/api/outlines/${f.outlineId}`;
  const p2 = (await (await page.request.post("/api/projects", { data: { title: "父级范围合成", slug: `outline-parent-${Date.now()}` } })).json()).data;
  const parent = (await (await page.request.post("/api/outlines", { data: { projectId: p2.id, level: "VOLUME", title: "其他项目卷纲", orderIndex: 0 } })).json()).data;
  expect((await page.request.post("/api/outlines", { data: { projectId: f.projectId, parentId: parent.id, level: "CHAPTER", title: "不得跨项目", orderIndex: 2 } })).status()).toBe(404);
  for (const data of [null, [], {}, { projectId: f.projectId, level: "CHAPTER", title: " ", orderIndex: 1 }, { projectId: f.projectId, level: "CHAPTER", title: "无效顺序", orderIndex: -1 }]) expect((await page.request.post("/api/outlines", { data })).status()).toBe(400);
  expect((await page.request.post("/api/outlines", { data: "{", headers: { "Content-Type": "application/json" } })).status()).toBe(400);
  for (const data of [null, [], { title: "" }, { summary: 123 }, { status: "INVALID" }]) expect((await page.request.patch(url, { data })).status()).toBe(400);
  const foreign = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    expect((await anonymous.patch(url, { data: { summary: "不应写入", baseRevisionHash: "a".repeat(64) } })).status()).toBe(401);
    expect((await foreign.post("/api/auth/register", { data: { email: `outline-foreign-${Date.now()}@example.com`, password: "outline-test-pass", displayName: "异组织大纲" } })).status()).toBe(201);
    expect((await foreign.patch(url, { data: { summary: "不应写入", baseRevisionHash: "a".repeat(64) } })).status()).toBe(404);
    expect((await foreign.post("/api/outlines", { data: { projectId: f.projectId, level: "CHAPTER", title: "不得跨组织" } })).status()).toBe(404);
    const rows = (await (await page.request.get(`/api/outlines?projectId=${f.projectId}`)).json()).data;
    expect(rows).toHaveLength(1); expect(rows[0].summary).toBe("作者保留摘要");
  } finally { await foreign.dispose(); await anonymous.dispose(); }
});
