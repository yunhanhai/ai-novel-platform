import { test, expect, type Page, type Route } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

const quote = "她推开门，雨水顺着袖口滴落。";
const original = `😀门外风急。${quote}桌上还摆着未喝完的茶。`;
const replacement = "她撑住门框，湿袖在地上洇开一片水。";
async function save(page: Page, id: string, content: string) {
  const base = (await (await page.request.get(`/api/chapters/${id}`)).json()).data;
  expect((await page.request.patch(`/api/chapters/${id}`, { data: { content, baseContentHash: base.contentHash } })).status()).toBe(200);
}
async function stored(page: Page, id: string) { return (await (await page.request.get(`/api/chapters/${id}`)).json()).data.content; }
async function setup(page: Page, text = original) {
  await warmUpAuthRoutes(page); const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  expect((await page.request.post("/api/auth/register", { data: { email: `review-source-${stamp}@example.com`, password: "review-source-test-pass", displayName: "审校来源合成" } })).status()).toBe(201);
  const p = (await (await page.request.post("/api/projects", { data: { title: "审校来源合成作品", slug: `review-source-${stamp}` } })).json()).data;
  const a = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "审校章甲" } })).json()).data;
  const b = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "审校章乙" } })).json()).data;
  await save(page, a.id, text); await save(page, b.id, text);
  await page.goto(`/projects/${p.id}/workspace`); await expect(page.locator(".editor-textarea")).toHaveValue(text);
  await page.getByRole("tab", { name: "审校", exact: true }).click();
  const id = "33333333-3333-4333-8333-333333333333";
  let completed = false, hash = "", submits = 0;
  await page.route("**/api/generation-jobs", async route => {
    submits++;
    const content = await stored(page, a.id);
    hash = await page.evaluate(async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join(""), content);
    await route.fulfill({ status: 201, json: { success: true, data: { id, jobType: "REVIEW", status: "QUEUED" } } });
  });
  let outputChapter = a.id as string, badHash = false, missingSource = false;
  await page.route(`**/api/generation-jobs/${id}`, async route => {
    await route.fulfill({ json: { success: true, data: { id, jobType: "REVIEW", status: completed ? "SUCCEEDED" : "RUNNING", progress: completed ? "100" : "0", errorMessage: null, startedAt: null, finishedAt: null,
      output: completed ? { chapterId: outputChapter, ...(missingSource ? {} : { sourceSha256: badHash ? "0".repeat(64) : hash }), sourceChars: Array.from(text).length,
        review: { summary: "合成合法审校建议", passed: false, suggestions: [{ issueType: "style_drift", severity: "warning", quote, problem: "动作可更具体", suggestion: "保留动作因果", replacement, verified: true }], verifiedCount: 1, unverifiedCount: 0, degraded: false } } : null } } });
  });
  let feedback = 0, feedbackBody: Record<string, unknown> | null = null;
  await page.route(`**/api/generation-jobs/${id}/feedback`, async route => { feedback++; feedbackBody = route.request().postDataJSON(); await route.fulfill({ json: { success: true } }); });
  return { chapterId: a.id as string, otherId: b.id as string, submits: () => submits, feedback: () => feedback,
    feedbackBody: () => feedbackBody, sourceHash: () => hash,
    complete: () => { completed = true; }, wrongChapter: () => { outputChapter = b.id; }, wrongHash: () => { badHash = true; }, missingSource: () => { missingSource = true; } };
}
async function run(page: Page) { await page.getByRole("button", { name: "开始审校", exact: true }).click(); }

test("旧审校报告在选区外改文后失效，不能替换新稿", async ({ page }) => {
  const f = await setup(page); await run(page); f.complete(); await expect(page.locator(".review-summary")).toBeVisible();
  const newer = original + "作者补充的章尾。"; await page.locator(".editor-textarea").fill(newer);
  await expect(page.getByRole("button", { name: "应用替换", exact: true })).toHaveCount(0);
  await expect(page.locator(".review-panel .form-error")).toContainText("重新审校");
  await expect(page.locator(".editor-textarea")).toHaveValue(newer); expect(f.feedback()).toBe(0);
});

test("重复引用只供参考，不能擅自替换第一处", async ({ page }) => {
  const f = await setup(page, original + quote); await run(page); f.complete(); await expect(page.locator(".review-summary")).toBeVisible();
  await expect(page.getByRole("button", { name: "应用替换", exact: true })).toBeDisabled();
  await expect(page.locator(".editor-textarea")).toHaveValue(original + quote); expect(f.feedback()).toBe(0);
});

test("审校完成前切章，不把甲章报告用于相同正文乙章", async ({ page }) => {
  const f = await setup(page); await run(page); await page.locator(".chapter-item").filter({ hasText: "审校章乙" }).click();
  await expect(page.locator(".editor-header h1")).toContainText("审校章乙"); f.complete();
  await expect(page.getByRole("button", { name: "开始审校", exact: true })).toBeEnabled();
  await expect(page.locator(".review-summary")).toHaveCount(0); await expect(page.locator(".editor-textarea")).toHaveValue(original);
});

test("唯一引用向编辑器采纳且保存，重挂标签不恢复旧报告", async ({ page }) => {
  const f = await setup(page); await run(page); f.complete(); await expect(page.locator(".review-summary")).toBeVisible();
  await page.getByRole("button", { name: "应用替换", exact: true }).click();
  const expected = original.replace(quote, replacement); await expect(page.locator(".editor-textarea")).toHaveValue(expected);
  await expect.poll(() => stored(page, f.chapterId)).toBe(expected); await expect.poll(() => f.feedback()).toBe(1);
  expect(f.feedbackBody()).toEqual({ chapterId: f.chapterId, sourceSha256: f.sourceHash(), suggestionIndex: 0, quote, replacement });
  await page.getByRole("tab", { name: "AI", exact: true }).click(); await page.getByRole("tab", { name: "审校", exact: true }).click();
  await expect(page.locator(".review-summary")).toHaveCount(0); await expect(page.locator(".editor-textarea")).toHaveValue(expected);
});

test("审校在途改文时拒绝旧来源报告", async ({ page }) => {
  const f = await setup(page); await run(page); const newer = original + "等待时新写内容。";
  await page.locator(".editor-textarea").fill(newer); f.complete();
  await expect(page.getByRole("button", { name: "开始审校", exact: true })).toBeEnabled();
  await expect(page.locator(".review-summary")).toHaveCount(0); await expect(page.locator(".editor-textarea")).toHaveValue(newer);
});

test("审校发起等待保存时改文撤销提交", async ({ page }) => {
  const f = await setup(page); let held: Route | null = null;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "PATCH" && !held) held = route; else await route.continue(); });
  await page.locator(".editor-textarea").fill(original + "第一次待保存。"); await run(page); await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator(".editor-textarea").fill(original + "后来输入。"); await held!.continue();
  await expect(page.locator(".review-panel .form-error")).toContainText("正文"); expect(f.submits()).toBe(0);
});

for (const kind of ["wrongChapter", "wrongHash", "missingSource"] as const) test(`拒绝不匹配或无来源的审校报告 ${kind}`, async ({ page }) => {
  const f = await setup(page);
  f[kind](); await run(page); f.complete();
  await expect(page.getByRole("button", { name: "开始审校", exact: true })).toBeEnabled();
  await expect(page.locator(".review-summary")).toHaveCount(0); await expect(page.locator(".review-panel .form-error")).toContainText("重新审校");
});
