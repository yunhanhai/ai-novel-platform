import { test, expect } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

test("真实取消接口保留完成状态、重复取消幂等并隔离组织", async ({ page, playwright }) => {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  const { prisma } = await import("../../../packages/db/src/index");
  await warmUpAuthRoutes(page);
  const own = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  const foreign = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    for (const [client, suffix] of [[own, "own"], [foreign, "foreign"]] as const) {
      const response = await client.post("/api/auth/register", { data: { email: `cancel-${stamp}-${suffix}@example.com`, password: "cancel-race-test-pass", displayName: "取消接口合成验证" } });
      expect(response.status()).toBe(201);
    }
    const projectResponse = await own.post("/api/projects", { data: { title: "取消接口合成项目", slug: `cancel-http-${stamp}` } });
    expect(projectResponse.status()).toBe(201);
    const projectId = (await projectResponse.json()).data.id;
    const chapterResponse = await own.post(`/api/projects/${projectId}/chapters`, { data: { title: "取消接口合成章" } });
    const chapterId = (await chapterResponse.json()).data.id;
    const createJob = () => own.post("/api/generation-jobs", { data: { chapterId, jobType: "POLISH", input: { selectedText: "正文不存在的合成选文" } } });
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId }, select: { organizationId: true, createdById: true } });
    // A future retry time holds this synthetic QUEUED job outside the live poller.
    const active = await prisma.generationJob.create({ data: {
      organizationId: chapter.organizationId, projectId, userId: chapter.createdById,
      jobType: "POLISH", status: "QUEUED", nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
      input: {}, targetEntityType: "CHAPTER", targetEntityId: chapterId
    } });
    const id = active.id;
    expect((await anonymous.post(`/api/generation-jobs/${id}/cancel`)).status()).toBe(401);
    expect((await foreign.post(`/api/generation-jobs/${id}/cancel`)).status()).toBe(404);
    const cancelled = await Promise.all([1, 2].map(() => own.post(`/api/generation-jobs/${id}/cancel`)));
    for (const response of cancelled) { expect(response.status(), await response.text()).toBe(200); expect((await response.json()).data.status).toBe("CANCELLED"); }
    const first = (await (await own.get(`/api/generation-jobs/${id}`)).json()).data;
    expect(first.status).toBe("CANCELLED");
    expect((await own.post(`/api/generation-jobs/${id}/cancel`)).status()).toBe(200);
    const repeated = (await (await own.get(`/api/generation-jobs/${id}`)).json()).data;
    expect(repeated.finishedAt).toBe(first.finishedAt);
    const finishedResponse = await createJob(); expect(finishedResponse.status()).toBe(201);
    const finishedId = (await finishedResponse.json()).data.id as string;
    await expect.poll(async () => (await (await own.get(`/api/generation-jobs/${finishedId}`)).json()).data.status).toBe("FAILED");
    const before = (await (await own.get(`/api/generation-jobs/${finishedId}`)).json()).data;
    expect((await own.post(`/api/generation-jobs/${finishedId}/cancel`)).status()).toBe(409);
    const after = (await (await own.get(`/api/generation-jobs/${finishedId}`)).json()).data;
    expect(after.status).toBe("FAILED"); expect(after.finishedAt).toBe(before.finishedAt); expect(after.errorCode).toBe(before.errorCode);
  } finally { await own.dispose(); await foreign.dispose(); await anonymous.dispose(); await prisma.$disconnect(); }
});
