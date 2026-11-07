import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../packages/db/src/index";
import { resolveModelProfile } from "../packages/model-adapters/src/model-resolver";
import { updateProvider } from "../apps/web/src/server/model-providers";
import { createProfile, updateProfile } from "../apps/web/src/server/model-profiles";
import { pingProvider } from "../apps/web/src/server/model-providers-test";

async function main() {
  const evidence: string[] = [];
  const rollback = new Error("verification rollback");
  try {
    await prisma.$transaction(async tx => {
      const userId = randomUUID(), orgA = randomUUID(), orgB = randomUUID();
      await tx.user.create({ data: { id: userId, email: `model-verify-${userId}@example.com`, displayName: "模型边界验收" } });
      for (const orgId of [orgA, orgB]) await tx.organization.create({ data: { id: orgId, name: "模型验收", slug: `mv-${orgId}`, ownerUserId: userId } });
      const projectA = await tx.project.create({ data: { organizationId: orgA, title: "模型验收A", slug: randomUUID(), createdById: userId } });
      const otherProject = await tx.project.create({ data: { organizationId: orgA, title: "模型验收A2", slug: randomUUID(), createdById: userId } });
      const providerA = await tx.modelProvider.create({ data: { organizationId: orgA, name: "A", providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", status: "ACTIVE" } });
      const providerB = await tx.modelProvider.create({ data: { organizationId: orgB, name: "B", providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", status: "ACTIVE" } });
      const profile = async (organizationId: string, providerId: string, projectId: string | null, modelName: string) => tx.modelProfile.create({ data: { organizationId, providerId, projectId, name: modelName, modelName, taskType: "default" } });
      const defaultA = await profile(orgA, providerA.id, null, "safe-default");
      const foreign = await profile(orgB, providerB.id, null, "foreign");
      const other = await profile(orgA, providerA.id, otherProject.id, "other-project");
      const input = { organizationId: orgA, projectId: projectA.id, taskType: "GENERATE_CHAPTER" };
      await updateProvider(orgA, providerA.id, { name: "safe provider edit", organizationId: orgB, authMode: "USER_KEY", encryptedApiKey: "injected" } as never, tx as never);
      const providerEdited = await tx.modelProvider.findUniqueOrThrow({ where: { id: providerA.id } });
      assert.equal(providerEdited.organizationId, orgA);
      assert.equal(providerEdited.authMode, "PLATFORM_KEY");
      assert.equal(providerEdited.encryptedApiKey, null);
      evidence.push("provider PATCH whitelist preserves organization and authentication credentials");
      await updateProfile(orgA, defaultA.id, { name: "safe edit", organizationId: orgB, providerId: providerB.id } as never, tx as never);
      const edited = await tx.modelProfile.findUniqueOrThrow({ where: { id: defaultA.id } });
      assert.equal(edited.organizationId, orgA);
      assert.equal(edited.providerId, providerA.id);
      evidence.push("profile PATCH whitelist prevents organization/provider reassignment");
      const createDeps = { organizationId: orgA, name: "boundary", modelName: "boundary", taskType: "default", prisma: tx as unknown as Parameters<typeof createProfile>[0]["prisma"] };
      await assert.rejects(createProfile({ ...createDeps, providerId: providerB.id }), /供应商不存在/);
      evidence.push("profile creation rejects a foreign provider association");
      assert.equal((await resolveModelProfile({ ...input, modelProfileId: foreign.id }, tx))?.id, defaultA.id);
      evidence.push("foreign explicit profile falls back within own organization");
      assert.equal((await resolveModelProfile({ ...input, modelProfileId: other.id }, tx))?.id, defaultA.id);
      evidence.push("other-project explicit profile cannot be used");
      assert.equal((await resolveModelProfile({ ...input, modelProfileId: defaultA.id }, tx))?.id, defaultA.id);
      evidence.push("organization default remains selectable for current project");
      await tx.modelProvider.update({ where: { id: providerA.id }, data: { status: "DISABLED" } });
      assert.equal(await resolveModelProfile(input, tx), null);
      evidence.push("disabled provider is excluded from every fallback");
      const deps = { prisma: tx as unknown as Parameters<typeof pingProvider>[0]["prisma"], organizationId: orgA, env: { USE_FAKE_MODEL: "true" } };
      assert.equal((await pingProvider({ ...deps, providerId: providerB.id })).ok, false);
      assert.equal((await pingProvider({ ...deps, providerId: providerA.id })).ok, false);
      evidence.push("demo ping rejects foreign and disabled providers without network");
      await tx.modelProvider.update({ where: { id: providerA.id }, data: { status: "ACTIVE" } });
      assert.deepEqual(await pingProvider({ ...deps, providerId: providerA.id }), { ok: true, mode: "fake" });
      evidence.push("owned active provider demo check remains available");
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await prisma.$disconnect(); }
  console.log(JSON.stringify({ checks: evidence.length, evidence, fixtures: "rolled back", externalModelRequests: 0 }, null, 2));
}
main().catch(() => { console.error("模型边界数据库验收失败，内部错误未输出"); process.exitCode = 1; });
