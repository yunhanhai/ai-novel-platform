import { test, expect, request as apiRequest } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";

const stamp = Date.now();
const password = "integration-test-password";

test("performance budgets, trends and recovery isolate session organizations", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await warmUpAuthRoutes(page);
  const a = await apiRequest.newContext({ baseURL: "http://localhost:3000" });
  const b = await apiRequest.newContext({ baseURL: "http://localhost:3000" });
  const anonymous = await apiRequest.newContext({ baseURL: "http://localhost:3000" });
  try {
    for (const path of ["/api/projects", "/api/performance-trends", "/api/performance-budgets", "/api/queue-observability", "/api/audit-logs/recovery-actions"]) {
      expect((await anonymous.get(path)).status(), path).toBe(401);
    }
    for (const [client, suffix] of [[a, "a"], [b, "b"]] as const) {
      const register = await client.post("/api/auth/register", { data: { email: `perf-${stamp}-${suffix}@example.com`, password, displayName: `隔离验收${suffix}` } });
      expect(register.status(), await register.text()).toBe(201);
    }
    const created = await a.post("/api/projects", { data: { title: "性能隔离验收", slug: `perf-${stamp}` } });
    expect(created.status()).toBe(201);
    const projectId = (await created.json()).data.id as string;
    const save = await a.put("/api/performance-budgets", { data: { scope: "ORGANIZATION", warningCents: 500, criticalCents: 1000 } });
    expect(save.status(), await save.text()).toBe(200);
    const concurrent = await Promise.all([700, 800].map(warningCents => a.put("/api/performance-budgets", { data: { scope: "PROJECT", projectId, warningCents, criticalCents: 1200 } })));
    for (const result of concurrent) expect(result.status(), await result.text()).toBe(200);
    const own = await a.get("/api/performance-budgets");
    expect((await own.json()).data).toHaveLength(2);
    expect((await (await b.get("/api/performance-budgets")).json()).data).toHaveLength(0);
    expect((await b.put("/api/performance-budgets", { data: { scope: "PROJECT", projectId, warningCents: 100 } })).status()).toBe(404);
    expect((await b.put("/api/performance-budgets", { data: { scope: "PROJECT", projectId, clear: true } })).status()).toBe(404);
    expect((await b.get(`/api/projects/${projectId}/performance-trends`)).status()).toBe(404);
    expect((await a.get(`/api/projects/${projectId}/performance-trends?window=7d`)).status()).toBe(200);
    expect((await a.get("/api/performance-trends?window=30d")).status()).toBe(200);
    for (const warningCents of [1.5, "12bad", -1, 2147483648]) {
      expect((await a.put("/api/performance-budgets", { data: { scope: "ORGANIZATION", warningCents } })).status()).toBe(400);
    }
    expect((await a.post("/api/queue-observability", { data: { action: "recover-expired-leases" } })).status()).toBe(200);
    const audit = (await (await a.get("/api/audit-logs/recovery-actions")).json()).data;
    expect(audit.items.some((item: { action: string }) => item.action === "queue.recover_expired_leases")).toBe(true);
    const foreignAudit = (await (await b.get("/api/audit-logs/recovery-actions")).json()).data;
    expect(foreignAudit.items).toHaveLength(0);

    await page.context().addCookies((await a.storageState()).cookies);
    await page.goto("/projects");
    await expect(page.getByText("全部项目性能", { exact: true })).toBeVisible();
    await expect(page.getByText("队列健康", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "预算", exact: true }).click();
    await expect(page.getByRole("heading", { name: "性能预算" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("performance-budget-desktop.png"), fullPage: true });
    const orgCard = page.locator(".budget-form").filter({ hasText: "组织默认预算" }).first();
    await orgCard.getByLabel("预警金额 ($)").fill("9.00");
    await orgCard.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("组织默认预算已保存", { exact: true })).toBeVisible();
    expect((await a.put("/api/performance-budgets", { data: { scope: "PROJECT", projectId, clear: true } })).status()).toBe(200);
    const clears = await Promise.all([1, 2].map(() => a.put("/api/performance-budgets", { data: { scope: "ORGANIZATION", clear: true } })));
    for (const result of clears) expect(result.status(), await result.text()).toBe(200);
    expect((await (await a.get("/api/performance-budgets")).json()).data).toHaveLength(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "性能预算" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("performance-budget-mobile.png"), fullPage: true });
  } finally { await a.dispose(); await b.dispose(); await anonymous.dispose(); }
});
