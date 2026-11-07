import { test, expect, type Page, type Route } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";
const firstId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
async function setup(page: Page) {
  await warmUpAuthRoutes(page); await page.goto("/register");
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await page.locator('input[type="email"]').fill(`stop-${stamp}@example.com`);
  await page.locator('input[type="text"]').first().fill("停止反馈验证");
  await page.locator('input[type="password"]').fill("stop-feedback-test-pass");
  await page.getByRole("button", { name: "注册" }).click(); await page.waitForURL("**/projects");
  const projectId = await page.evaluate(async stamp => {
    const project = (await (await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "停止反馈合成项目", slug: `stop-${stamp}` }) })).json()).data;
    await fetch(`/api/projects/${project.id}/chapters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "停止反馈章" }) });
    return project.id as string;
  }, stamp);
  await page.goto(`/projects/${projectId}/workspace`); await expect(page.locator(".editor-textarea")).toBeEnabled();
  const states: Record<string, string> = { [firstId]: "RUNNING", [secondId]: "RUNNING" };
  let creates = 0; let reads = 0;
  const summary = (id: string) => ({ id, jobType: "DESLOP", status: states[id], progress: "0", output: null, errorMessage: null, startedAt: null, finishedAt: null, steps: [] });
  await page.route("**/api/generation-jobs", async route => {
    const id = ++creates === 1 ? firstId : secondId;
    await route.fulfill({ status: 201, json: { success: true, data: { id, jobType: "DESLOP", status: "QUEUED" } } });
  });
  await page.route(/\/api\/generation-jobs\/[0-9a-f-]+$/, async route => { reads++; const id = route.request().url().split("/").pop()!; await route.fulfill({ json: { success: true, data: summary(id) } }); });
  await page.getByRole("button", { name: "去 AI 味", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeVisible();
  return { states, summary, reads: () => reads };
}
const alert = (page: Page) => page.getByRole("alert", { name: "停止任务反馈" });

test("停止失败可见并可重试，成功确认立即更新状态", async ({ page }) => {
  const f = await setup(page); let attempts = 0;
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
    if (++attempts === 1) await route.fulfill({ status: 503, json: { success: false, error: "临时无法停止，请重试" } });
    else { f.states[firstId] = "CANCELLED"; await route.fulfill({ json: { success: true, data: { id: firstId, status: "CANCELLED" } } }); }
  });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(alert(page)).toHaveText("临时无法停止，请重试");
  await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(page.locator(".job-status-card")).toContainText("已取消"); await expect(alert(page)).toHaveCount(0);
});

test("停止冲突不虚报取消，并立即读取真实完成状态", async ({ page }) => {
  const f = await setup(page);
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
    f.states[firstId] = "SUCCEEDED";
    await route.fulfill({ status: 409, json: { success: false, error: "任务已结束，无需停止" } });
  });
  const before = f.reads();
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(alert(page)).toContainText("任务已结束，无需停止");
  await expect.poll(f.reads).toBeGreaterThan(before);
  await expect(page.locator(".job-status-card")).toContainText("已完成");
  await expect(page.locator(".job-status-card")).not.toContainText("已取消");
});

test("只有有效的同任务取消确认才可显示已取消", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
    await route.fulfill({ json: { success: true, data: { id: secondId, status: "CANCELLED" } } });
  });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(alert(page)).toContainText("未确认");
  await expect(page.locator(".job-status-card")).not.toContainText("已取消");
});

async function holdResponse(page: Page, key: string, suffix: string, method: string) {
  await page.evaluate(({ key, suffix, method }) => {
    const target = window as unknown as { stopHolds: Record<string, { release: () => void; aborted: () => boolean }> };
    target.stopHolds ??= {};
    const original = window.fetch.bind(window); let used = false;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (used || !url.endsWith(suffix) || (init?.method ?? "GET") !== method) return original(input, init);
      used = true;
      // Even an already-parsed response may finish after abort: test the state guard too.
      const response = await original(input, { ...init, signal: undefined });
      const body = await response.text();
      return new Promise<Response>(resolve => { target.stopHolds[key] = {
        aborted: () => init?.signal?.aborted ?? false,
        release: () => resolve(new Response(body, { status: response.status, headers: { "Content-Type": "application/json" } }))
      }; });
    };
  }, { key, suffix, method });
}
async function held(page: Page, key: string) {
  await expect.poll(() => page.evaluate(key => Boolean((window as unknown as { stopHolds: Record<string, unknown> }).stopHolds[key]), key)).toBe(true);
}
async function release(page: Page, key: string) {
  await page.evaluate(key => (window as unknown as { stopHolds: Record<string, { release: () => void }> }).stopHolds[key]!.release(), key);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const kind of ["unauthorized", "missing", "invalid-json", "network"] as const) {
  test(`停止错误不伪造取消：${kind}`, async ({ page }) => {
    await setup(page);
    await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
      if (kind === "network") await route.abort("failed");
      else if (kind === "invalid-json") await route.fulfill({ status: 200, contentType: "text/html", body: "<html>broken</html>" });
      else await route.fulfill({ status: kind === "unauthorized" ? 401 : 404, json: { success: false } });
    });
    await page.getByRole("button", { name: "停止任务", exact: true }).click();
    await expect(alert(page)).toContainText(kind === "unauthorized" ? "重新登录" : kind === "missing" ? "无权访问" : "未确认");
    await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeEnabled();
    await expect(page.locator(".job-status-card")).not.toContainText("已取消");
  });
}

test("取消确认后的旧RUNNING轮询不能回退终态", async ({ page }) => {
  const f = await setup(page);
  await holdResponse(page, "old-poll", `/api/generation-jobs/${firstId}`, "GET");
  await held(page, "old-poll");
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
    f.states[firstId] = "CANCELLED"; await route.fulfill({ json: { success: true, data: { id: firstId, status: "CANCELLED" } } });
  });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(page.locator(".job-status-card")).toContainText("已取消");
  expect(await page.evaluate(() => (window as unknown as { stopHolds: Record<string, { aborted: () => boolean }> }).stopHolds["old-poll"]!.aborted())).toBe(true);
  await release(page, "old-poll");
  await expect(page.locator(".job-status-card")).toContainText("已取消");
  await expect(page.getByRole("button", { name: "停止任务", exact: true })).toHaveCount(0);
});

test("旧停止响应与finally不能影响新任务的停止状态", async ({ page }) => {
  const f = await setup(page);
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => { await route.fulfill({ json: { success: true, data: { id: firstId, status: "CANCELLED" } } }); });
  await holdResponse(page, "old-stop", `/api/generation-jobs/${firstId}/cancel`, "POST");
  await page.getByRole("button", { name: "停止任务", exact: true }).click(); await held(page, "old-stop");
  f.states[firstId] = "SUCCEEDED";
  await expect(page.locator(".job-status-card")).toContainText("已完成");
  await page.getByRole("button", { name: "去 AI 味", exact: true }).click();
  await expect(page.locator(".job-status-id")).toHaveText("44444444");
  await page.route(`**/api/generation-jobs/${secondId}/cancel`, async route => { await route.fulfill({ status: 503, json: { success: false, error: "当前任务停止失败" } }); });
  await holdResponse(page, "new-stop", `/api/generation-jobs/${secondId}/cancel`, "POST");
  await page.getByRole("button", { name: "停止任务", exact: true }).click(); await held(page, "new-stop");
  await release(page, "old-stop");
  await expect(page.getByRole("button", { name: "停止中...", exact: true })).toBeDisabled();
  await expect(page.locator(".job-status-card")).not.toContainText("已取消"); await expect(alert(page)).toHaveCount(0);
  await release(page, "new-stop");
  await expect(alert(page)).toHaveText("当前任务停止失败"); await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeEnabled();
});

test("旧任务GET迟到不能覆盖新任务，旧请求已取消", async ({ page }) => {
  const f = await setup(page);
  await holdResponse(page, "old-read", `/api/generation-jobs/${firstId}`, "GET"); await held(page, "old-read");
  f.states[firstId] = "CANCELLED";
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => { await route.fulfill({ json: { success: true, data: { id: firstId, status: "CANCELLED" } } }); });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(page.locator(".job-status-card")).toContainText("已取消");
  await page.getByRole("button", { name: "去 AI 味", exact: true }).click();
  await expect(page.locator(".job-status-id")).toHaveText("44444444");
  await release(page, "old-read");
  await expect(page.locator(".job-status-id")).toHaveText("44444444");
  await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeEnabled();
});

test("成功取消后的刷新失败不丢弃有效确认", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
    await page.route(`**/api/generation-jobs/${firstId}`, async read => { await read.fulfill({ status: 503, json: { success: false } }); });
    await route.fulfill({ json: { success: true, data: { id: firstId, status: "CANCELLED" } } });
  });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(page.locator(".job-status-card")).toContainText("已取消"); await expect(alert(page)).toHaveCount(0);
});

test("冲突后的刷新失败明确提示未取得最新状态", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
    await page.route(`**/api/generation-jobs/${firstId}`, async read => { await read.fulfill({ status: 503, json: { success: false } }); });
    await route.fulfill({ status: 409, json: { success: false } });
  });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(alert(page)).toContainText("暂未取得最新状态");
  await expect(page.locator(".job-status-card")).not.toContainText("已取消");
});

test("旧轮询结束后不能重排定时器打断冲突的慢刷新", async ({ page }) => {
  const f = await setup(page);
  await holdResponse(page, "prior-read", `/api/generation-jobs/${firstId}`, "GET"); await held(page, "prior-read");
  await holdResponse(page, "immediate-refresh", `/api/generation-jobs/${firstId}`, "GET");
  await page.route(`**/api/generation-jobs/${firstId}/cancel`, async route => {
    f.states[firstId] = "SUCCEEDED"; await route.fulfill({ status: 409, json: { success: false } });
  });
  await page.getByRole("button", { name: "停止任务", exact: true }).click(); await held(page, "immediate-refresh");
  await release(page, "prior-read");
  // Cross the 1500ms polling interval while the immediate response remains held.
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => (window as unknown as { stopHolds: Record<string, { aborted: () => boolean }> }).stopHolds["immediate-refresh"]!.aborted())).toBe(false);
  await release(page, "immediate-refresh");
  await expect(page.locator(".job-status-card")).toContainText("已完成");
});
