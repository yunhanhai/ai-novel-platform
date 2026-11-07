import { test, expect } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";
import { randomUUID, createHash } from "node:crypto";

for (const failure of ["network", "server", "invalid-json", "stale-source"] as const) {
test(`创建未确认复用凭证且恢复完整候选：${failure}`, async ({ page }) => {
  await warmUpAuthRoutes(page); await page.goto("/register");
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await page.locator('input[type="email"]').fill(`create-${stamp}@example.com`); await page.locator('input[type="text"]').first().fill("创建凭证验证");
  await page.locator('input[type="password"]').fill("creation-receipt-test-pass"); await page.getByRole("button", { name: "注册" }).click(); await page.waitForURL("**/projects");
  const projectId = await page.evaluate(async stamp => {
    const project = (await (await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "创建确认合成项目", slug: `create-${stamp}` }) })).json()).data;
    const chapter = (await (await fetch(`/api/projects/${project.id}/chapters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "确认章" }) })).json()).data;
    await fetch(`/api/chapters/${chapter.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "她坐在窗边。", baseContentHash: (await (await fetch(`/api/chapters/${chapter.id}`)).json()).data.contentHash }) });
    return project.id as string;
  }, stamp);
  await page.goto(`/projects/${projectId}/workspace`); const editor = page.locator(".editor-textarea"); await expect(editor).toHaveValue("她坐在窗边。");
  const bodies: Array<Record<string, unknown>> = []; const jobId = "55555555-5555-8555-8555-555555555555";
  await page.route("**/api/generation-jobs", async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      if (failure === "network" || failure === "stale-source") await route.abort("failed");
      else if (failure === "server") await route.fulfill({ status: 503, json: { success: false, error: "创建确认暂不可用" } });
      else await route.fulfill({ status: 201, contentType: "text/html", body: "broken" });
    }
    else await route.fulfill({ status: 201, json: { success: true, data: { id: jobId, jobType: "POLISH", status: "SUCCEEDED", progress: "100", output: { mode: "POLISH", selectedText: "她坐在窗边。", newText: "她倚在窗畔。", sourceSha256: createHash("sha256").update("她坐在窗边。").digest("hex") }, errorMessage: null, startedAt: null, finishedAt: null } } });
  });
  await editor.click(); await page.keyboard.press("ControlOrMeta+a"); await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect(page.locator(".ai-panel-content .form-error")).toBeVisible();
  if (failure === "stale-source") {
    await editor.fill("她坐在窗边。作者另改背景。"); await editor.click(); await page.keyboard.press("ControlOrMeta+Home"); await page.keyboard.down("Shift"); for (let i = 0; i < "她坐在窗边。".length; i++) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
  }
  await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/); expect(bodies[1]!.requestId).toBe(bodies[0]!.requestId);
  if (failure === "stale-source") {
    await expect(page.locator(".rewrite-result-notice")).toContainText("原文已发生变化"); await expect(page.getByRole("button", { name: "应用到编辑器", exact: true })).toHaveCount(0); return;
  }
  await expect(page.locator(".rewrite-result-card")).toContainText("她倚在窗畔。");
  await page.getByRole("button", { name: "丢弃", exact: true }).click();
  await editor.click(); await page.keyboard.press("ControlOrMeta+a"); await page.getByRole("button", { name: "润色", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(3); expect(bodies[2]!.requestId).not.toBe(bodies[1]!.requestId);
});

}

test("真实HTTP重复创建同一凭证只返回原任务，冲突与租户隔离有效", async ({ page, playwright }) => {
  await warmUpAuthRoutes(page);
  const own = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  const foreign = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    for (const [client, name] of [[own, "own"], [foreign, "foreign"]] as const) {
      expect((await client.post("/api/auth/register", { data: { email: `create-http-${stamp}-${name}@example.com`, password: "create-receipt-test-pass", displayName: "创建凭证HTTP验证" } })).status()).toBe(201);
    }
    const project = (await (await own.post("/api/projects", { data: { title: "创建凭证HTTP合成", slug: `receipt-http-${stamp}` } })).json()).data;
    const chapter = (await (await own.post(`/api/projects/${project.id}/chapters`, { data: { title: "空章不调用模型" } })).json()).data;
    const requestId = randomUUID();
    const body = { chapterId: chapter.id, jobType: "POLISH", input: { selectedText: "不存在的合成选文" }, requestId };
    const responses = await Promise.all([own.post("/api/generation-jobs", { data: body }), own.post("/api/generation-jobs", { data: body })]);
    for (const response of responses) expect(response.status(), await response.text()).toBe(201);
    const first = (await responses[0]!.json()).data; expect((await responses[1]!.json()).data.id).toBe(first.id);
    await expect.poll(async () => (await (await own.get(`/api/generation-jobs/${first.id}`)).json()).data.status).toBe("FAILED");
    const terminal = (await (await own.get(`/api/generation-jobs/${first.id}`)).json()).data;
    const replay = await own.post("/api/generation-jobs", { data: body }); expect(replay.status()).toBe(201);
    expect((await replay.json()).data).toMatchObject({ id: first.id, status: "FAILED", finishedAt: terminal.finishedAt, errorMessage: terminal.errorMessage });
    const listed = (await (await own.get(`/api/generation-jobs?chapterId=${chapter.id}`)).json()).data; expect(listed).toHaveLength(1);
    expect((await own.post("/api/generation-jobs", { data: { ...body, input: { selectedText: "不同参数" } } })).status()).toBe(409);
    expect((await foreign.post("/api/generation-jobs", { data: body })).status()).toBe(404);
    expect((await foreign.post("/api/generation-jobs", { data: { projectId: project.id, jobType: "GENERATE_OUTLINE", requestId } })).status()).toBe(404);
    expect((await own.post("/api/generation-jobs", { data: { ...body, requestId: "invalid" } })).status()).toBe(400);
  } finally { await own.dispose(); await foreign.dispose(); }
});
