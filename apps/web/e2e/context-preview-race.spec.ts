import { test, expect, type Page } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

type HoldRule = { id: string; preset?: string; chapterId?: string };
declare global {
  interface Window {
    previewRace: {
      armed: HoldRule[];
      pending: Record<string, { aborted: () => boolean; release: (kind: "success" | "error") => void }>;
      delivered: string[];
    };
  }
}

async function controlledPreviews(page: Page) {
  // Deliberately finish a response even after abort: state guards must also
  // handle a transport/body parser that has already completed its network work.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.previewRace = { armed: [], pending: {}, delivered: [] };
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (!url.includes("/context-preview") || init?.method !== "POST") return originalFetch(input, init);
      const options = JSON.parse(String(init.body)).contextOptions;
      const chapterId = url.split("/chapters/")[1]!.split("/")[0]!;
      const index = window.previewRace.armed.findIndex(rule => (!rule.preset || rule.preset === options.budgetPreset) && (!rule.chapterId || rule.chapterId === chapterId));
      if (index < 0) return originalFetch(input, init);
      const [rule] = window.previewRace.armed.splice(index, 1);
      const response = await originalFetch(input, { ...init, signal: undefined });
      const payload = await response.json();
      return new Promise<Response>(resolve => {
        window.previewRace.pending[rule!.id] = {
          aborted: () => init.signal?.aborted ?? false,
          release: kind => {
            const body = kind === "error" ? { success: false, error: `旧请求错误-${rule!.id}` } : {
              ...payload, data: { ...payload.data, promptPreview: `${payload.data.promptPreview}\n旧响应-${rule!.id}` }
            };
            window.previewRace.delivered.push(rule!.id);
            resolve(new Response(JSON.stringify(body), { status: kind === "error" ? 503 : 200, headers: { "Content-Type": "application/json" } }));
          }
        };
      });
    };
  });
}

async function setup(page: Page) {
  await controlledPreviews(page);
  await warmUpAuthRoutes(page);
  await page.goto("/register");
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  await page.locator('input[type="email"]').fill(`preview-${stamp}@example.com`);
  await page.locator('input[type="text"]').first().fill("预览顺序验证");
  await page.locator('input[type="password"]').fill("preview-race-test-pass");
  await page.getByRole("button", { name: "注册" }).click();
  await page.waitForURL("**/projects");
  const fixture = await page.evaluate(async stamp => {
    async function create(url: string, body: unknown) {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error("preview fixture creation failed");
      return json.data;
    }
    const project = await create("/api/projects", { title: "预览顺序合成项目", slug: `preview-${stamp}` });
    const a = await create(`/api/projects/${project.id}/chapters`, { title: "章节甲顺序标记" });
    const b = await create(`/api/projects/${project.id}/chapters`, { title: "章节乙顺序标记" });
    const memory = await create("/api/project-memories", { projectId: project.id, memoryType: "world_fact", scopeType: "project", content: "可排除的共享线索" });
    const accepted = await fetch(`/api/project-memories/${memory.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "accepted" }) });
    if (!accepted.ok) throw new Error("preview fixture acceptance failed");
    return { projectId: project.id as string, a: a.id as string, b: b.id as string };
  }, stamp);
  await page.goto(`/projects/${fixture.projectId}/workspace`);
  await expect(page.getByRole("region", { name: "上下文编排器" }).locator(".context-prompt-preview pre")).toContainText("章节甲顺序标记");
  return fixture;
}

async function arm(page: Page, rule: HoldRule) {
  await page.evaluate(rule => window.previewRace.armed.push(rule), rule);
}
async function held(page: Page, id: string) {
  await expect.poll(() => page.evaluate(id => Boolean(window.previewRace.pending[id]), id)).toBe(true);
}
async function release(page: Page, id: string, kind: "success" | "error") {
  await page.evaluate(({ id, kind }) => window.previewRace.pending[id]!.release(kind), { id, kind });
  // Allow the deliberately released promise, response.json and React commit to finish.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("预览选项乱序：旧成功不能覆盖最新请求", async ({ page }) => {
  await setup(page);
  const composer = page.getByRole("region", { name: "上下文编排器" });
  const prompt = composer.locator(".context-prompt-preview pre");
  await arm(page, { id: "old-success", preset: "compact" });
  await composer.getByRole("button", { name: "精简", exact: true }).click();
  await held(page, "old-success");
  await composer.getByRole("button", { name: "丰富", exact: true }).click();
  await expect(composer.locator(".context-summary-grid")).toContainText("/7000");
  expect(await page.evaluate(() => window.previewRace.pending["old-success"]!.aborted())).toBe(true);
  await release(page, "old-success", "success");
  await expect(composer.locator(".context-summary-grid")).toContainText("/7000");
  await expect(prompt).not.toContainText("旧响应-old-success");

});

test("预览选项乱序：旧错误和finally不能覆盖新请求状态", async ({ page }) => {
  await setup(page);
  const composer = page.getByRole("region", { name: "上下文编排器" });
  await arm(page, { id: "old-error", preset: "compact" });
  await composer.getByRole("button", { name: "精简", exact: true }).click();
  await held(page, "old-error");
  await arm(page, { id: "new-pending", preset: "standard" });
  await composer.getByRole("button", { name: "标准", exact: true }).click();
  await held(page, "new-pending");
  expect(await page.evaluate(() => window.previewRace.pending["old-error"]!.aborted())).toBe(true);
  expect(await page.evaluate(() => window.previewRace.pending["new-pending"]!.aborted())).toBe(false);
  await release(page, "old-error", "error");
  await expect(composer.getByRole("button", { name: "刷新中...", exact: true })).toBeDisabled();
  await expect(composer.locator(".form-error")).toHaveCount(0);
  await release(page, "new-pending", "success");
  await expect(composer.locator(".context-summary-grid")).toContainText("/4000");
  await expect(composer.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  await expect(composer.locator(".form-error")).toHaveCount(0);
});

test("预览章节隔离：切章与卸载后不接收旧响应", async ({ page }) => {
  const fixture = await setup(page);
  const composer = page.getByRole("region", { name: "上下文编排器" });
  const prompt = composer.locator(".context-prompt-preview pre");
  await composer.locator(".context-asset-group li").filter({ hasText: "world_fact" }).getByRole("button", { name: "排除", exact: true }).click();
  await expect(composer.getByRole("heading", { name: "已排除", exact: true })).toBeVisible();
  await arm(page, { id: "chapter-a", preset: "compact", chapterId: fixture.a });
  await composer.getByRole("button", { name: "精简", exact: true }).click();
  await held(page, "chapter-a");
  await page.locator(".chapter-item").filter({ hasText: "章节乙顺序标记" }).click();
  await expect(prompt).toContainText("章节乙顺序标记");
  await expect(composer.getByRole("heading", { name: "已排除", exact: true })).toHaveCount(0);
  await expect(prompt).toContainText("可排除的共享线索");
  await expect(composer.locator(".context-summary-grid")).toContainText("/2400");
  expect(await page.evaluate(() => window.previewRace.pending["chapter-a"]!.aborted())).toBe(true);
  await release(page, "chapter-a", "success");
  await expect(prompt).toContainText("章节乙顺序标记");
  await expect(prompt).not.toContainText("旧响应-chapter-a");

  // Capture the real generate action without creating a job/model request.
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/generation-jobs", async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { success: false, error: "合成验证已停止提交" } });
  });
  await page.getByRole("button", { name: "生成章节", exact: true }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted).toMatchObject({ chapterId: fixture.b, contextOptions: { budgetPreset: "compact", excludedAssetIds: [], forcedAssetIds: [] } });
  await page.unroute("**/api/generation-jobs");

  await arm(page, { id: "unmounted", preset: "rich", chapterId: fixture.b });
  await composer.getByRole("button", { name: "丰富", exact: true }).click();
  await held(page, "unmounted");
  await page.getByRole("tab", { name: "作品", exact: true }).click();
  await expect(composer).toHaveCount(0);
  expect(await page.evaluate(() => window.previewRace.pending["unmounted"]!.aborted())).toBe(true);
  await release(page, "unmounted", "error");
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await expect(prompt).toContainText("章节乙顺序标记");
  await expect(composer.locator(".form-error")).toHaveCount(0);
});


test("当前预览失败可见，手动刷新后恢复且不残留旧结果", async ({ page }) => {
  await setup(page);
  const composer = page.getByRole("region", { name: "上下文编排器" });
  await arm(page, { id: "current-error", preset: "standard" });
  await composer.getByRole("button", { name: "刷新", exact: true }).click();
  await held(page, "current-error");
  await expect(composer.locator(".context-prompt-preview pre")).toHaveCount(0);
  await release(page, "current-error", "error");
  await expect(composer.locator(".form-error")).toHaveText("旧请求错误-current-error");
  await expect(composer.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  await composer.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(composer.locator(".context-prompt-preview pre")).toContainText("章节甲顺序标记");
  await expect(composer.locator(".form-error")).toHaveCount(0);
});
