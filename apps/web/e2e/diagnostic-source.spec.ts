import { test, expect, type Page, type Route } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

const original = "😀门外风急，她推开门，雨水顺着袖口滴落。桌上还摆着未喝完的茶。";
async function save(page: Page, id: string, content: string) {
  const base = (await (await page.request.get(`/api/chapters/${id}`)).json()).data;
  expect((await page.request.patch(`/api/chapters/${id}`, { data: { content, baseContentHash: base.contentHash } })).status()).toBe(200);
}
async function stored(page: Page, id: string) { return (await (await page.request.get(`/api/chapters/${id}`)).json()).data.content; }
async function setup(page: Page) {
  await warmUpAuthRoutes(page); const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  expect((await page.request.post("/api/auth/register", { data: { email: `diagnostic-${stamp}@example.com`, password: "diagnostic-source-test-pass", displayName: "诊断来源合成" } })).status()).toBe(201);
  const p = (await (await page.request.post("/api/projects", { data: { title: "诊断合成作品", slug: `diagnostic-${stamp}` } })).json()).data;
  const a = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "诊断章甲" } })).json()).data;
  const b = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "诊断章乙" } })).json()).data;
  await save(page, a.id, original); await save(page, b.id, original);
  await page.goto(`/projects/${p.id}/workspace`); await expect(page.locator(".editor-textarea")).toHaveValue(original);
  const id = "44444444-4444-4444-8444-444444444444";
  let completed = false, hash = "", submits = 0, status = "SUCCEEDED", outputChapter = a.id as string, badHash = false, missingSource = false;
  await page.route("**/api/generation-jobs", async route => {
    submits++; const content = await stored(page, a.id);
    hash = await page.evaluate(async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join(""), content);
    await route.fulfill({ status: 201, json: { success: true, data: { id, jobType: "DIAGNOSE_CHAPTER", status: "QUEUED" } } });
  });
  await page.route(`**/api/generation-jobs/${id}`, async route => {
    await route.fulfill({ json: { success: true, data: { id, jobType: "DIAGNOSE_CHAPTER", status: completed ? status : "RUNNING", progress: completed ? "100" : "0", errorMessage: status === "SUCCEEDED" ? null : "合成任务未成功", startedAt: null, finishedAt: null,
      output: completed ? { chapterId: outputChapter, ...(missingSource ? {} : { sourceSha256: badHash ? "0".repeat(64) : hash }), sourceChars: Array.from(original).length, diagnosticType: "DIAGNOSE_CHAPTER",
        diagnosticSummary: { readerScore: 82, abandonRisk: "low", hookStrength: 75, pacingScore: 81, styleDrift: 12, continuityIssues: [{ severity: "info", detail: "合成连续性观察", suggestion: "核对动作衔接" }], suggestions: ["合成诊断建议"] },
        performanceSummary: { qualityMode: "balanced", modelCalls: 1, inputTokens: 100, outputTokens: 50, latencyMs: 10 } } : null } } });
  });
  return { chapterId: a.id as string, submits: () => submits, complete: () => { completed = true; }, wrongChapter: () => { outputChapter = b.id; }, wrongHash: () => { badHash = true; }, missingSource: () => { missingSource = true; }, failed: () => { status = "FAILED"; } };
}
async function run(page: Page) { await page.getByRole("button", { name: "运行诊断", exact: true }).click(); }
const result = (page: Page) => page.locator('[aria-label="质量诊断结果"]');

test("正文改动后旧诊断不再显示当前稿评分", async ({ page }) => {
  const f = await setup(page); await run(page); f.complete(); await expect(result(page)).toBeVisible();
  await page.locator(".editor-textarea").fill(original + "新写章尾。");
  await expect(result(page)).toHaveCount(0); await expect(page.getByRole("status", { name: "诊断来源提示" })).toContainText("重新诊断");
});

test("切章后相同正文也不显示另一章诊断", async ({ page }) => {
  const f = await setup(page); await run(page); f.complete(); await expect(result(page)).toBeVisible();
  await page.locator(".chapter-item").filter({ hasText: "诊断章乙" }).click(); await expect(page.locator(".editor-header h1")).toContainText("诊断章乙");
  await expect(result(page)).toHaveCount(0);
});

test("有效完整来源展示参考评分，诊断成功不刷新正文", async ({ page }) => {
  const f = await setup(page); let reads = 0;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "GET") reads++; await route.continue(); });
  await run(page); f.complete(); await expect(result(page)).toBeVisible(); await expect(result(page)).toContainText("读者评分 82");
  await expect(result(page)).toContainText("仅供"); expect(reads).toBe(0); await expect(page.getByLabel("性能摘要")).toBeVisible();
});

test("等待保存继续改文阻止诊断提交", async ({ page }) => {
  const f = await setup(page); let held: Route | null = null;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH" && !held) held = route; else await route.continue(); });
  await page.locator(".editor-textarea").fill(original + "先输入。"); await run(page); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".editor-textarea").fill(original + "后来输入。"); await held!.continue();
  await expect(page.getByRole("alert", { name: "诊断准备提示" })).toContainText("正文"); expect(f.submits()).toBe(0);
});

test("诊断在途改文拒绝旧结果，标签重挂仍不恢复", async ({ page }) => {
  const f = await setup(page); await run(page); const newer = original + "等待中新稿。"; await page.locator(".editor-textarea").fill(newer); f.complete();
  await expect(page.locator(".tag-job-succeeded")).toBeVisible(); await expect(result(page)).toHaveCount(0);
  await expect(page.getByRole("status", { name: "诊断来源提示" })).toContainText("重新诊断");
  await page.getByRole("tab", { name: "版本", exact: true }).click(); await page.getByRole("tab", { name: "AI", exact: true }).click();
  await expect(result(page)).toHaveCount(0); await expect(page.locator(".editor-textarea")).toHaveValue(newer);
});

for (const kind of ["wrongChapter", "wrongHash", "missingSource", "failed"] as const) test(`来源或终态无效不展示评分 ${kind}`, async ({ page }) => {
  const f = await setup(page); f[kind](); await run(page); f.complete();
  await expect(page.getByRole("button", { name: "运行诊断", exact: true })).toBeEnabled(); await expect(result(page)).toHaveCount(0);
});
