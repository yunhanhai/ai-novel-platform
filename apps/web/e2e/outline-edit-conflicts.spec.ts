import { test, expect, type Page, type Route } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

async function setup(page: Page) {
  await warmUpAuthRoutes(page); const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  expect((await page.request.post("/api/auth/register", { data: { email: `outline-edit-${stamp}@example.com`, password: "outline-edit-test-pass", displayName: "大纲冲突合成" } })).status()).toBe(201);
  const p = (await (await page.request.post("/api/projects", { data: { title: "大纲冲突作品", slug: `outline-edit-${stamp}` } })).json()).data;
  await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "冲突合成章" } });
  const create = await page.request.post("/api/outlines", { data: { projectId: p.id, level: "CHAPTER", title: "共同标题", summary: "共同摘要", orderIndex: 1 } }); expect(create.status()).toBe(201);
  const item = (await create.json()).data;
  await page.goto(`/projects/${p.id}/workspace`); await expect(page.locator(".editor-textarea")).toBeEnabled(); await open(page);
  return { projectId: p.id as string, outlineId: item.id as string };
}
async function open(page: Page) { await page.getByRole("tab", { name: "大纲", exact: true }).click(); await expect(page.locator(".resource-card-header")).toContainText("共同标题"); }
async function edit(page: Page) { await page.locator(".resource-card").first().getByRole("button", { name: "编辑", exact: true }).click(); }
async function item(page: Page, projectId: string, id: string) {
  return (await (await page.request.get(`/api/outlines?projectId=${projectId}`)).json()).data.find((row: { id: string }) => row.id === id);
}
async function remoteSave(page: Page, f: { projectId: string; outlineId: string }, summary: string) {
  const base = await item(page, f.projectId, f.outlineId);
  expect((await page.request.patch(`/api/outlines/${f.outlineId}`, { data: { summary, baseRevisionHash: base.revisionHash } })).status()).toBe(200);
}

test("双页旧大纲保存409保留本地，明确保留本地才覆盖远端", async ({ page, context }) => {
  const f = await setup(page); const other = await context.newPage(); await other.goto(`/projects/${f.projectId}/workspace`); await expect(other.locator(".editor-textarea")).toBeEnabled(); await open(other);
  await edit(page); await edit(other);
  await page.locator(".resource-form textarea").fill("甲页最新摘要"); await page.getByRole("button", { name: "更新", exact: true }).click(); await expect(page.locator(".resource-form")).toHaveCount(0);
  await other.locator(".resource-form textarea").fill("乙页本地摘要"); await other.getByRole("button", { name: "更新", exact: true }).click();
  await expect(other.getByRole("region", { name: "大纲冲突处理" })).toBeVisible(); await expect(other.locator(".resource-form textarea")).toHaveValue("乙页本地摘要");
  expect((await item(page, f.projectId, f.outlineId)).summary).toBe("甲页最新摘要");
  await other.getByRole("button", { name: "读取最新大纲", exact: true }).click(); await expect(other.getByRole("region", { name: "大纲冲突处理" })).toContainText("甲页最新摘要");
  await other.getByRole("button", { name: "保留本地并保存", exact: true }).click(); await expect(other.locator(".resource-form")).toHaveCount(0);
  expect((await item(page, f.projectId, f.outlineId)).summary).toBe("乙页本地摘要"); await other.close();
});

test("冲突读取失败不丢表单，不允许未核对覆盖", async ({ page }) => {
  const f = await setup(page); await edit(page); await page.locator(".resource-form textarea").fill("本地保留稿"); await remoteSave(page, f, "远端最新稿");
  await page.getByRole("button", { name: "更新", exact: true }).click(); await expect(page.getByRole("region", { name: "大纲冲突处理" })).toBeVisible();
  await page.route(`**/api/outlines/${f.outlineId}`, async route => { if (route.request().method() === "GET") await route.fulfill({ status: 503, json: { success: false, error: "合成读取失败" } }); else await route.continue(); });
  await page.getByRole("button", { name: "读取最新大纲", exact: true }).click(); await expect(page.getByRole("region", { name: "大纲冲突处理" })).toContainText("读取失败");
  await expect(page.locator(".resource-form textarea")).toHaveValue("本地保留稿"); await expect(page.getByRole("button", { name: "保留本地并保存", exact: true })).toBeDisabled();
  expect((await item(page, f.projectId, f.outlineId)).summary).toBe("远端最新稿");
});

test("明确采用远端后才替换本地表单，冲突读取等待期间仍保留输入", async ({ page }) => {
  const f = await setup(page); await edit(page); await page.locator(".resource-form textarea").fill("旧本地表单"); await remoteSave(page, f, "远端版本一");
  await page.getByRole("button", { name: "更新", exact: true }).click(); await expect(page.getByRole("region", { name: "大纲冲突处理" })).toBeVisible();
  let held: Route | null = null; await page.route(`**/api/outlines/${f.outlineId}`, async route => { if (route.request().method() === "GET") held = route; else await route.continue(); });
  await page.getByRole("button", { name: "读取最新大纲", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".resource-form textarea").fill("读取期间新输入"); await held!.continue(); await expect(page.getByRole("region", { name: "大纲冲突处理" })).toContainText("远端版本一");
  await expect(page.locator(".resource-form textarea")).toHaveValue("读取期间新输入");
  await page.getByRole("button", { name: "采用远端版本", exact: true }).click(); await expect(page.locator(".resource-form textarea")).toHaveValue("远端版本一");
  await expect(page.getByRole("region", { name: "大纲冲突处理" })).toHaveCount(0);
});

test("读取后远端再次变化，保留本地仍409不覆盖", async ({ page }) => {
  const f = await setup(page); await edit(page); await page.locator(".resource-form textarea").fill("本地待覆盖稿"); await remoteSave(page, f, "远端版本一");
  await page.getByRole("button", { name: "更新", exact: true }).click(); await page.getByRole("button", { name: "读取最新大纲", exact: true }).click();
  await expect(page.getByRole("region", { name: "大纲冲突处理" })).toContainText("远端版本一"); await remoteSave(page, f, "远端版本二");
  await page.getByRole("button", { name: "保留本地并保存", exact: true }).click(); await expect(page.getByRole("region", { name: "大纲冲突处理" })).toBeVisible();
  await expect(page.locator(".resource-form textarea")).toHaveValue("本地待覆盖稿"); expect((await item(page, f.projectId, f.outlineId)).summary).toBe("远端版本二");
});

test("保存已写库但确认丢失，同稿重试不改变更新时间", async ({ page }) => {
  const f = await setup(page); await edit(page); await page.locator(".resource-form textarea").fill("已提交未确认摘要"); let first = true;
  await page.route(`**/api/outlines/${f.outlineId}`, async route => { if (first && route.request().method() === "PATCH") { first = false; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "更新", exact: true }).click(); await expect(page.locator(".resource-panel > .form-error")).toBeVisible();
  const before = await item(page, f.projectId, f.outlineId); expect(before.summary).toBe("已提交未确认摘要");
  await page.getByRole("button", { name: "更新", exact: true }).click(); await expect(page.locator(".resource-form")).toHaveCount(0);
  expect((await item(page, f.projectId, f.outlineId)).updatedAt).toBe(before.updatedAt);
});

test("旧列表删除请求携带原基线并被409拒绝", async ({ page }) => {
  const f = await setup(page); await remoteSave(page, f, "刚更新不得删除"); page.on("dialog", dialog => dialog.accept()); let proof: unknown;
  await page.route(`**/api/outlines/${f.outlineId}`, async route => { if (route.request().method() === "DELETE") proof = route.request().postDataJSON(); await route.continue(); });
  const response = page.waitForResponse(r => r.url().endsWith(`/api/outlines/${f.outlineId}`) && r.request().method() === "DELETE");
  await page.getByRole("button", { name: "删除", exact: true }).click(); expect((await response).status()).toBe(409);
  await expect(page.locator(".resource-panel > .form-error")).toContainText("未执行本次操作");
  expect(proof).toMatchObject({ baseRevisionHash: expect.stringMatching(/^[a-f0-9]{64}$/) }); expect((await item(page, f.projectId, f.outlineId)).summary).toBe("刚更新不得删除");
});
