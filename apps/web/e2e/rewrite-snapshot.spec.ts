import { test, expect, type Page } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

const original = "同一句。\n中间未改。\n同一句。";
const selectedText = "同一句。";
const newText = "候选新句。";

async function setup(page: Page) {
  await warmUpAuthRoutes(page);
  await page.goto("/register");
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  await page.locator('input[type="email"]').fill(`rewrite-${stamp}@example.com`);
  await page.locator('input[type="text"]').first().fill("选区来源验证");
  await page.locator('input[type="password"]').fill("rewrite-snapshot-test-pass");
  await page.getByRole("button", { name: "注册" }).click();
  await page.waitForURL("**/projects");
  const fixture = await page.evaluate(async ({ stamp, original }) => {
    async function create(url: string, body: unknown) {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error("rewrite fixture creation failed");
      return json.data;
    }
    const project = await create("/api/projects", { title: "改写来源合成项目", slug: `rewrite-${stamp}` });
    const a = await create(`/api/projects/${project.id}/chapters`, { title: "改写来源章节甲" });
    const b = await create(`/api/projects/${project.id}/chapters`, { title: "改写来源章节乙" });
    for (const chapter of [a, b]) {
      const response = await fetch(`/api/chapters/${chapter.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: original, baseContentHash: (await (await fetch(`/api/chapters/${chapter.id}`)).json()).data.contentHash }) });
      if (!response.ok) throw new Error("rewrite fixture text failed");
    }
    return { projectId: project.id as string, a: a.id as string, b: b.id as string };
  }, { stamp, original });
  await page.goto(`/projects/${fixture.projectId}/workspace`);
  const editor = page.locator(".editor-textarea");
  await expect(editor).toHaveValue(original);
  let completed = false;
  const id = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/generation-jobs", async route => {
    await route.fulfill({ status: 201, json: { success: true, data: { id, jobType: "POLISH", status: "QUEUED" } } });
  });
  await page.route(`**/api/generation-jobs/${id}`, async route => {
    await route.fulfill({ json: { success: true, data: { id, jobType: "POLISH", status: completed ? "SUCCEEDED" : "RUNNING", progress: completed ? "100" : "0", errorMessage: null, startedAt: null, finishedAt: null, output: completed ? { mode: "POLISH", selectedText, newText } : null } } });
  });
  return { ...fixture, editor, complete: () => { completed = true; } };
}
async function select(page: Page, start: number, end: number) {
  await expect(page.locator(".editor-textarea")).toBeEnabled();
  await page.locator(".editor-textarea").click();
  await page.keyboard.press("ControlOrMeta+Home");
  for (let index = 0; index < start; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");
  for (let index = start; index < end; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(page.locator(".selection-toolbar")).toBeVisible();
}
async function start(page: Page) {
  await select(page, 0, selectedText.length);
  await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect(page.locator(".job-status-card")).toContainText("排队中");
}

test("润色完成前移动到重复片段，仍仅替换发起时的选区", async ({ page }) => {
  const f = await setup(page); await start(page);
  await select(page, original.lastIndexOf(selectedText), original.length);
  f.complete();
  await expect(page.getByRole("button", { name: "应用到编辑器", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
  await expect(f.editor).toHaveValue(newText + original.slice(selectedText.length));
  await expect(page.getByRole("button", { name: "应用到编辑器", exact: true })).toHaveCount(0);
});

test("甲章候选不能借用乙章相同选文", async ({ page }) => {
  const f = await setup(page); await start(page);
  await page.locator(".chapter-item").filter({ hasText: "改写来源章节乙" }).click();
  await expect(page.locator(".editor-header h1")).toContainText("改写来源章节乙");
  await expect(f.editor).toHaveValue(original);
  await select(page, 0, selectedText.length);
  f.complete();
  await expect(page.locator(".job-status-card")).toContainText("已完成");
  await expect(page.getByRole("button", { name: "应用到编辑器", exact: true })).toHaveCount(0);
  await expect(f.editor).toHaveValue(original);
});

test("候选完成后修改选区外正文也必须拒绝旧快照", async ({ page }) => {
  const f = await setup(page); await start(page); f.complete();
  await expect(page.getByRole("button", { name: "应用到编辑器", exact: true })).toBeVisible();
  const edited = original.replace("中间未改", "作者新改");
  await f.editor.fill(edited);
  await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
  await expect(f.editor).toHaveValue(edited);
  await expect(page.locator(".rewrite-result-notice")).toContainText("原文已发生变化");
});

test("尚未自动保存的选文在提交润色前先保存", async ({ page }) => {
  const f = await setup(page);
  const edited = "全新未保存选文。";
  const heldPatches: import("@playwright/test").Route[] = [];
  let submitted = false;
  await page.route(`**/api/chapters/${f.a}`, async route => {
    if (route.request().method() === "PATCH") { heldPatches.push(route); return; }
    await route.continue();
  });
  await page.route("**/api/generation-jobs", async route => {
    submitted = true;
    await route.fulfill({ status: 400, json: { success: false, error: "合成验证停止任务创建" } });
  });
  await f.editor.fill(edited); await select(page, 0, edited.length);
  await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect.poll(() => heldPatches.length).toBeGreaterThan(0);
  expect(submitted).toBe(false);
  await heldPatches[0]!.continue();
  await expect.poll(() => submitted).toBe(true);
  const stored = await page.evaluate(async chapterId => (await (await fetch(`/api/chapters/${chapterId}`)).json()).data.content, f.a);
  expect(stored).toBe(edited);
});

test("保存失败时保留编辑内容且不创建润色任务", async ({ page }) => {
  const f = await setup(page); let submitted = false;
  await page.route(`**/api/chapters/${f.a}`, async route => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 503, json: { success: false, error: "合成保存失败" } });
    else await route.continue();
  });
  await page.route("**/api/generation-jobs", async route => { submitted = true; await route.abort(); });
  const edited = "保存失败时的新选文。";
  await f.editor.fill(edited); await select(page, 0, edited.length);
  await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect(page.locator(".rewrite-result-notice")).toContainText("正文保存失败");
  expect(submitted).toBe(false); await expect(f.editor).toHaveValue(edited);
});

test("等待保存时继续编辑会撤销提交并保存最新内容", async ({ page }) => {
  const f = await setup(page); let submitted = false;
  let first: import("@playwright/test").Route | null = null; let patchCount = 0;
  await page.route(`**/api/chapters/${f.a}`, async route => {
    if (route.request().method() === "PATCH" && ++patchCount === 1) { first = route; return; }
    await route.continue();
  });
  await page.route("**/api/generation-jobs", async route => { submitted = true; await route.abort(); });
  await f.editor.fill("保存期间的初稿。"); await select(page, 0, 8);
  await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect.poll(() => Boolean(first)).toBe(true);
  const latest = "等待旧稿保存期间又写的新稿。";
  await f.editor.fill(latest);
  await first!.continue();
  await expect(page.locator(".rewrite-result-notice")).toContainText("原文已发生变化");
  expect(submitted).toBe(false);
  await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/chapters/${id}`)).json()).data.content, f.a)).toBe(latest);
  await expect(f.editor).toHaveValue(latest);
});

test("创建回执延迟期间切章，完成结果仍不得进入新章", async ({ page }) => {
  const f = await setup(page);
  let createRoute: import("@playwright/test").Route | null = null;
  await page.route("**/api/generation-jobs", async route => { createRoute = route; });
  await select(page, 0, selectedText.length);
  await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect.poll(() => Boolean(createRoute)).toBe(true);
  await page.locator(".chapter-item").filter({ hasText: "改写来源章节乙" }).click();
  await expect(page.locator(".editor-header h1")).toContainText("改写来源章节乙");
  await expect(f.editor).toBeEnabled();
  await createRoute!.fulfill({ status: 201, json: { success: true, data: { id: "22222222-2222-4222-8222-222222222222", jobType: "POLISH", status: "QUEUED" } } });
  await select(page, 0, selectedText.length); f.complete();
  await expect(page.locator(".job-status-card")).toContainText("已完成");
  await expect(page.getByRole("button", { name: "应用到编辑器", exact: true })).toHaveCount(0);
  await expect(f.editor).toHaveValue(original);
});

test("取消的润色结果即使携带候选也不能采纳", async ({ page }) => {
  const f = await setup(page); await start(page);
  await page.route("**/api/generation-jobs/22222222-2222-4222-8222-222222222222", async route => {
    await route.fulfill({ json: { success: true, data: { id: "22222222-2222-4222-8222-222222222222", jobType: "POLISH", status: "CANCELLED", progress: "0", errorMessage: null, output: { mode: "POLISH", selectedText, newText } } } });
  });
  await expect(page.locator(".job-status-card")).toContainText("已取消");
  await expect(page.getByRole("button", { name: "应用到编辑器", exact: true })).toHaveCount(0);
  await expect(f.editor).toHaveValue(original);
});

test("旧保存请求挂起时新稿必须排队，最终数据库保留最新稿", async ({ page }) => {
  const f = await setup(page);
  let first: import("@playwright/test").Route | null = null;
  let second: import("@playwright/test").Route | null = null;
  const older = "旧保存请求的正文。";
  const latest = "后来编辑的最新正文。";
  const writes: string[] = [];
  await page.route(`**/api/chapters/${f.a}`, async route => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    const text = route.request().postDataJSON().content as string;
    writes.push(text);
    if (text === older) { first = route; return; }
    if (text === latest) { second = route; return; }
    await route.continue();
  });
  await f.editor.fill(older);
  await expect.poll(() => Boolean(first)).toBe(true);
  await f.editor.fill(latest);
  // A real debounce window must expire while the first request is still held.
  await page.waitForTimeout(1800);
  expect(second).toBeNull();
  await first!.continue();
  await expect.poll(() => Boolean(second)).toBe(true);
  await second!.continue();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/chapters/${id}`)).json()).data.content, f.a)).toBe(latest);
  expect(writes).toEqual([older, latest]);
  await expect(f.editor).toHaveValue(latest);
});
