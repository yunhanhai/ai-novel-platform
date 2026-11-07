import { test, expect, type Page, type Route } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { warmUpAuthRoutes } from "./helpers";

async function setup(page: Page) {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  await warmUpAuthRoutes(page);
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const registration = await page.request.post("/api/auth/register", { data: { email: `restore-${stamp}@example.com`, password: "restore-test-pass", displayName: "回滚合成验收" } });
  expect(registration.status()).toBe(201);
  const p = (await (await page.request.post("/api/projects", { data: { title: "回滚合成作品", slug: `restore-${stamp}` } })).json()).data;
  const a = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "回滚章甲" } })).json()).data;
  const b = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "回滚章乙" } })).json()).data;
  await save(page, a.id, "确认前当前正文。");
  const { prisma } = await import("../../../packages/db/src/index");
  const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: a.id } });
  // Synthetic versions only. The public create-version endpoint is outside this test.
  const v = await prisma.contentVersion.create({ data: { organizationId: chapter.organizationId, projectId: p.id, entityType: "CHAPTER", entityId: a.id, versionNo: 1, content: "历史目标正文。", source: "AI", createdById: chapter.createdById } });
  await prisma.$disconnect();
  await page.goto(`/projects/${p.id}/workspace`);
  await expect(page.locator(".editor-textarea")).toHaveValue("确认前当前正文。");
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  await expect(page.locator(".version-card")).toHaveCount(1);
  return { chapterId: a.id as string, otherId: b.id as string, versionId: v.id };
}
async function save(page: Page, chapterId: string, content: string) {
  const base = (await (await page.request.get(`/api/chapters/${chapterId}`)).json()).data;
  const result = await page.request.patch(`/api/chapters/${chapterId}`, { data: { content, baseContentHash: base.contentHash } });
  expect(result.status()).toBe(200);
}
async function stored(page: Page, chapterId: string) { return (await (await page.request.get(`/api/chapters/${chapterId}`)).json()).data.content; }
async function begin(page: Page) { await page.getByRole("button", { name: "回滚到此版本", exact: true }).first().click(); await expect(page.locator(".version-confirm")).toBeVisible(); }

test("回滚前先保存编辑器新稿并快照，成功后刷新正文", async ({ page }) => {
  const f = await setup(page);
  await page.locator(".editor-textarea").fill("尚在防抖中的作者新稿。");
  await begin(page);
  expect(await stored(page, f.chapterId)).toBe("尚在防抖中的作者新稿。");
  await page.getByRole("button", { name: "确认回滚", exact: true }).click();
  await expect(page.locator(".editor-textarea")).toHaveValue("历史目标正文。");
  const versions = (await (await page.request.get(`/api/chapters/${f.chapterId}/versions`)).json()).data;
  expect(versions.some((v: { contentPreview: string }) => v.contentPreview === "尚在防抖中的作者新稿。")).toBe(true);
});

test("保存失败阻止回滚并保留编辑器稿", async ({ page }) => {
  const f = await setup(page); let posts = 0;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH") await route.fulfill({ status: 503, json: { success: false } }); else await route.continue(); });
  await page.route(`**/api/content-versions/${f.versionId}`, async route => { posts++; await route.continue(); });
  await page.locator(".editor-textarea").fill("不能丢失的未存稿。");
  await page.getByRole("button", { name: "回滚到此版本", exact: true }).click();
  await expect(page.locator(".side-tab-body .form-error")).toContainText("保存");
  expect(posts).toBe(0); expect(await stored(page, f.chapterId)).toBe("确认前当前正文。");
  await expect(page.locator(".editor-textarea")).toHaveValue("不能丢失的未存稿。");
});

test("确认后远端更新返回409且不覆盖新稿", async ({ page }) => {
  const f = await setup(page); await begin(page);
  await save(page, f.chapterId, "远端后来保存的稿。");
  const response = page.waitForResponse(r => r.url().endsWith(`/api/content-versions/${f.versionId}`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "确认回滚", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(page.locator(".side-tab-body .form-error")).toContainText("未执行回滚");
  expect(await stored(page, f.chapterId)).toBe("远端后来保存的稿。");
});

test("确认期间继续编辑使旧确认失效", async ({ page }) => {
  const f = await setup(page); await begin(page); let posts = 0;
  await page.route(`**/api/content-versions/${f.versionId}`, async route => { posts++; await route.continue(); });
  await page.locator(".editor-textarea").fill("确认后继续输入的新稿。");
  await expect(page.locator(".version-confirm")).toHaveCount(0);
  expect(posts).toBe(0); await expect(page.locator(".editor-textarea")).toHaveValue("确认后继续输入的新稿。");
});

test("等待保存时又输入不会拿新基线继续旧回滚", async ({ page }) => {
  const f = await setup(page); let held: Route | null = null;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH" && !held) held = route; else await route.continue(); });
  await page.locator(".editor-textarea").fill("第一次待保存稿。");
  await page.getByRole("button", { name: "回滚到此版本", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".editor-textarea").fill("等待期间后输入稿。"); await held!.continue();
  await expect(page.locator(".version-confirm")).toHaveCount(0);
  await expect(page.locator(".side-tab-body .form-error")).toContainText("正文");
  await expect(page.locator(".editor-textarea")).toHaveValue("等待期间后输入稿。");
});

test("回滚已写库但确认丢失时安全重试且不增加版本", async ({ page }) => {
  const f = await setup(page); let first = true;
  await begin(page);
  await page.route(`**/api/content-versions/${f.versionId}`, async route => { if (first) { first = false; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "确认回滚", exact: true }).click();
  await expect(page.locator(".resource-panel > .form-error")).toBeVisible();
  await expect.poll(() => stored(page, f.chapterId)).toBe("历史目标正文。");
  const count = (await (await page.request.get(`/api/chapters/${f.chapterId}/versions`)).json()).data.length;
  await page.getByRole("button", { name: "确认回滚", exact: true }).click();
  await expect(page.locator(".editor-textarea")).toHaveValue("历史目标正文。");
  expect((await (await page.request.get(`/api/chapters/${f.chapterId}/versions`)).json()).data.length).toBe(count);
});

test("切章后迟到列表与对比不能串入新章", async ({ page }) => {
  const f = await setup(page); let held: Route | null = null;
  await page.route(`**/api/chapters/${f.chapterId}/versions`, async route => { held = route; });
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".chapter-item").filter({ hasText: "回滚章乙" }).click();
  await expect(page.locator(".editor-header h1")).toContainText("回滚章乙"); await held!.continue();
  await expect(page.locator(".version-card")).toHaveCount(0);
  await page.unroute(`**/api/chapters/${f.chapterId}/versions`);
  await page.locator(".chapter-item").filter({ hasText: "回滚章甲" }).click(); await expect(page.locator(".version-card")).toHaveCount(1);
  held = null; await page.route(`**/api/chapters/${f.chapterId}/versions/diff?*`, async route => { held = route; });
  await page.getByRole("button", { name: "对比当前", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".chapter-item").filter({ hasText: "回滚章乙" }).click(); await held!.continue();
  await expect(page.locator(".version-card")).toHaveCount(0); await expect(page.locator(".version-diff")).toHaveCount(0);
});

test("回滚在途继续输入，迟到刷新保留本地新稿并提示冲突", async ({ page }) => {
  const f = await setup(page); await begin(page); let held: Route | null = null;
  await page.route(`**/api/content-versions/${f.versionId}`, async route => { held = route; });
  await page.getByRole("button", { name: "确认回滚", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".editor-textarea").fill("请求在途时继续写的新稿。");
  await held!.continue(); await expect.poll(() => stored(page, f.chapterId)).toBe("历史目标正文。");
  await expect(page.locator(".editor-textarea")).toHaveValue("请求在途时继续写的新稿。");
  await expect(page.locator(".external-update-notice")).toBeVisible();
});

test("切章后迟到回滚确认不会刷新或覆盖新章", async ({ page }) => {
  const f = await setup(page); await begin(page); let held: Route | null = null;
  await page.route(`**/api/content-versions/${f.versionId}`, async route => { held = route; });
  await page.getByRole("button", { name: "确认回滚", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".chapter-item").filter({ hasText: "回滚章乙" }).click(); await expect(page.locator(".editor-header h1")).toContainText("回滚章乙");
  await page.locator(".editor-textarea").fill("乙章独立新稿。"); await held!.continue();
  await expect.poll(() => stored(page, f.chapterId)).toBe("历史目标正文。");
  await expect(page.locator(".editor-textarea")).toHaveValue("乙章独立新稿。");
  await expect(page.locator(".version-card")).toHaveCount(0);
});

test("真实回滚HTTP要求基线并隔离未登录、异组织和错误章节", async ({ page, playwright }) => {
  const f = await setup(page);
  const url = `/api/content-versions/${f.versionId}`;
  const base = (await (await page.request.get(`/api/chapters/${f.chapterId}`)).json()).data;
  const body = { chapterId: f.chapterId, baseContentHash: base.contentHash };
  expect((await page.request.post(url, { data: {} })).status()).toBe(400);
  expect((await page.request.post(url, { data: { ...body, chapterId: f.otherId } })).status()).toBe(404);
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  const foreign = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    expect((await anonymous.post(url, { data: body })).status()).toBe(401);
    expect((await foreign.post("/api/auth/register", { data: { email: `restore-foreign-${Date.now()}@example.com`, password: "restore-test-pass", displayName: "异组织回滚" } })).status()).toBe(201);
    expect((await foreign.post(url, { data: body })).status()).toBe(404);
    expect(await stored(page, f.chapterId)).toBe("确认前当前正文。");
  } finally { await anonymous.dispose(); await foreign.dispose(); }
});
