import { test, expect, type Page } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { warmUpAuthRoutes } from "./helpers";

async function setup(page: Page) {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  await warmUpAuthRoutes(page); const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  expect((await page.request.post("/api/auth/register", { data: { email: `feedback-${stamp}@example.com`, password: "feedback-test-pass", displayName: "采纳反馈合成" } })).status()).toBe(201);
  const p = (await (await page.request.post("/api/projects", { data: { title: "反馈合成作品", slug: `feedback-${stamp}` } })).json()).data;
  const c = (await (await page.request.post(`/api/projects/${p.id}/chapters`, { data: { title: "反馈合成章" } })).json()).data;
  const content = "她推开门，雨水顺着袖口滴落。他靠着窗，手中还握着空杯。";
  const base = (await (await page.request.get(`/api/chapters/${c.id}`)).json()).data;
  expect((await page.request.patch(`/api/chapters/${c.id}`, { data: { content, baseContentHash: base.contentHash } })).status()).toBe(200);
  const fresh = (await (await page.request.get(`/api/chapters/${c.id}`)).json()).data;
  const { prisma } = await import("../../../packages/db/src/index");
  const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: c.id } });
  const suggestions = [
    { issueType: "style_drift", severity: "warning", quote: "她推开门，雨水顺着袖口滴落。", problem: "动作可具体", suggestion: "补充动作", replacement: "她撑住门框，湿袖贴在手背上。", verified: true },
    { issueType: "style_drift", severity: "warning", quote: "她推开门，雨水顺着袖口滴落。", problem: "另一种改法", suggestion: "保留雨水", replacement: "她推门进来，袖口的水滴落在门槛上。", verified: true },
    { issueType: "style_drift", severity: "info", quote: "他靠着窗，手中还握着空杯。", problem: "可更凝练", suggestion: "改动作", replacement: "他倚窗攥着空杯。", verified: true }
  ];
  const output = { chapterId: c.id, sourceSha256: fresh.contentHash, sourceChars: content.length, extra: { preserve: "保留字段" }, review: { summary: "合成合法审校报告", passed: false, suggestions, verifiedCount: 3, unverifiedCount: 0, degraded: false } };
  const job = await prisma.generationJob.create({ data: { organizationId: chapter.organizationId, projectId: p.id, userId: chapter.createdById, jobType: "REVIEW", targetEntityType: "CHAPTER", targetEntityId: c.id, status: "SUCCEEDED", input: {}, output, progress: 100, finishedAt: new Date() } });
  await prisma.$disconnect();
  const proof = (suggestionIndex: number) => ({ chapterId: c.id, sourceSha256: fresh.contentHash, suggestionIndex, quote: suggestions[suggestionIndex]!.quote, replacement: suggestions[suggestionIndex]!.replacement });
  return { projectId: p.id as string, chapterId: c.id as string, jobId: job.id, output, proof, content };
}
async function read(page: Page, id: string) { return (await (await page.request.get(`/api/generation-jobs/${id}`)).json()).data; }

test("真实并发反馈保留两条采纳，重复反馈保留首次元数据", async ({ page }) => {
  const f = await setup(page); const url = `/api/generation-jobs/${f.jobId}/feedback`;
  const responses = await Promise.all([1, 2].map(i => page.request.post(url, { data: f.proof(i) })));
  for (const response of responses) expect(response.status(), await response.text()).toBe(200);
  const before = await read(page, f.jobId);
  expect(before.output.review.suggestions.map((s: { applied?: boolean }) => s.applied === true)).toEqual([false, true, true]);
  expect(before.output.extra).toEqual(f.output.extra); expect(before.status).toBe("SUCCEEDED");
  const repeat = await page.request.post(url, { data: f.proof(1) }); expect(repeat.status()).toBe(200);
  expect((await read(page, f.jobId)).output).toEqual(before.output);
  const ack = (await repeat.json()).data; expect(ack.appliedAt).toBe(before.output.review.suggestions[1].appliedAt);
  expect(ack.appliedById).toBe(before.output.review.suggestions[1].appliedById);
});

test("真实反馈HTTP拒绝无凭据、错误来源和身份范围，非法反馈零写入", async ({ page, playwright }) => {
  const f = await setup(page); const url = `/api/generation-jobs/${f.jobId}/feedback`; const before = await read(page, f.jobId);
  for (const data of [null, [], { quote: f.proof(1).quote }, { ...f.proof(1), suggestionIndex: -1 }]) expect((await page.request.post(url, { data })).status()).toBe(400);
  expect((await page.request.post(url, { data: "{", headers: { "Content-Type": "application/json" } })).status()).toBe(400);
  for (const data of [{ ...f.proof(1), sourceSha256: "0".repeat(64) }, { ...f.proof(1), replacement: "不匹配的改法" }, { ...f.proof(1), chapterId: "11111111-1111-1111-1111-111111111111" }]) expect((await page.request.post(url, { data })).status()).toBe(409);
  expect((await page.request.post(url, { data: { ...f.proof(1), suggestionIndex: 99 } })).status()).toBe(404);
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  const foreign = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    expect((await anonymous.post(url, { data: f.proof(1) })).status()).toBe(401);
    expect((await foreign.post("/api/auth/register", { data: { email: `feedback-foreign-${Date.now()}@example.com`, password: "feedback-test-pass", displayName: "异组织反馈" } })).status()).toBe(201);
    expect((await foreign.post(url, { data: f.proof(1) })).status()).toBe(404);
    expect((await read(page, f.jobId)).output).toEqual(before.output);
  } finally { await anonymous.dispose(); await foreign.dispose(); }
});

test("浏览器采纳同引用第二种改法，只记录第二建议且正文正常保存", async ({ page }) => {
  const f = await setup(page);
  await page.goto(`/projects/${f.projectId}/workspace`); await expect(page.locator(".editor-textarea")).toHaveValue(f.content);
  let contentReads = 0;
  await page.route(`**/api/chapters/${f.chapterId}`, async route => { if (route.request().method() === "GET") contentReads++; await route.continue(); });
  await page.route("**/api/generation-jobs", async route => { await route.fulfill({ status: 201, json: { success: true, data: { id: f.jobId, jobType: "REVIEW", status: "SUCCEEDED", progress: "100", errorMessage: null, startedAt: null, finishedAt: null, output: f.output } } }); });
  await page.getByRole("tab", { name: "审校", exact: true }).click(); await page.getByRole("button", { name: "开始审校", exact: true }).click();
  await expect(page.locator(".review-item")).toHaveCount(3);
  expect(contentReads).toBe(0);
  const response = page.waitForResponse(r => r.url().endsWith(`/api/generation-jobs/${f.jobId}/feedback`));
  await page.getByRole("button", { name: "应用替换", exact: true }).nth(1).click(); expect((await response).status()).toBe(200);
  await expect(page.locator(".editor-textarea")).toHaveValue(f.content.replace(f.proof(1).quote, f.proof(1).replacement));
  await expect(page.locator(".save-status")).toHaveText("已保存");
  const job = await read(page, f.jobId); expect(job.output.review.suggestions.map((s: { applied?: boolean }) => s.applied === true)).toEqual([false, true, false]);
});
