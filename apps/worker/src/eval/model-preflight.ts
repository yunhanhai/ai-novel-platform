import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { readWebModelEnv } from "./model-preflight-env";
import { assessModelReadiness, canDecryptStoredCredential, buildReadinessProfileFilter } from "./model-readiness";

function readEnvFile(path: string): Record<string, string | undefined> {
  try { return parseEnv(readFileSync(path, "utf8")); }
  catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw new Error("无法读取环境配置文件");
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const workerEnv = { ...readEnvFile(resolve(root, ".env")), ...process.env };
  const webEnv = readWebModelEnv(resolve(root, "apps/web"));
  const args = process.argv.slice(2);
  const allowed = ["--json", "--organization-id=", "--project-id=", "--profile-id="];
  if (args.some(arg => !allowed.some(option => option.endsWith("=") ? arg.startsWith(option) : arg === option))) {
    throw new Error("参数仅支持 --json、--organization-id=UUID、--project-id=UUID、--profile-id=UUID");
  }
  const where: { organizationId?: string; projectId?: string; id?: string } = {};
  for (const [option, field] of [["organization-id", "organizationId"], ["project-id", "projectId"], ["profile-id", "id"]] as const) {
    const value = args.find(arg => arg.startsWith(`--${option}=`))?.slice(option.length + 3);
    if (value !== undefined) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error(`--${option} 必须为 UUID`);
      where[field] = value;
    }
  }
  if (!workerEnv.DATABASE_URL) throw new Error("根 .env 缺少 DATABASE_URL");
  process.env.DATABASE_URL = workerEnv.DATABASE_URL;
  const { prisma } = await import("@ai-novel/db");
  try {
    const project = where.projectId ? await prisma.project.findFirst({ where: { id: where.projectId, ...(where.organizationId ? { organizationId: where.organizationId } : {}), deletedAt: null }, select: { id: true, organizationId: true } }) : undefined;
    const profiles = await prisma.modelProfile.findMany({ where: buildReadinessProfileFilter(where, project), select: { id: true, organizationId: true, projectId: true, providerId: true, modelName: true } });
    const providers = await prisma.modelProvider.findMany({ where: { id: { in: [...new Set(profiles.map(profile => profile.providerId))] } },
      select: { id: true, organizationId: true, providerType: true, authMode: true, status: true, baseUrl: true, encryptedApiKey: true } });
    const report = assessModelReadiness({ workerEnv, webEnv, providers, profiles });
    const decryptable = new Map<string, boolean>();
    for (const provider of providers) {
      if (provider.authMode !== "USER_KEY") continue;
      decryptable.set(provider.id, await canDecryptStoredCredential(provider.encryptedApiKey, workerEnv.ENCRYPTION_KEY, webEnv.ENCRYPTION_KEY));
    }
    for (const check of report.checks) {
      if (decryptable.get(check.providerId) === false) { check.issues.push("STORED_API_KEY_DECRYPTION_FAILED"); check.ready = false; }
    }
    if (workerEnv.DATABASE_URL !== webEnv.DATABASE_URL) report.issues.push("WEB_WORKER_DATABASE_URL_MISMATCH");
    report.ready = report.issues.length === 0 && report.checks.some(check => check.ready);
    const grouped = new Map<string, { modelName: string; ready: boolean; issues: string[]; profiles: number }>();
    for (const check of report.checks) {
      const groupKey = JSON.stringify([check.modelName, check.ready, check.issues]);
      const entry = grouped.get(groupKey) ?? { modelName: check.modelName, ready: check.ready, issues: check.issues, profiles: 0 };
      entry.profiles++; grouped.set(groupKey, entry);
    }
    const output = args.includes("--json") ? report : {
      ready: report.ready, issues: report.issues, profilesChecked: profiles.length, providersChecked: providers.length,
      configurations: [...grouped.values()], scope: report.scope,
      next: report.ready ? "本地配置检查通过；下一步由操作者执行真实测试连接，尚未验证网络、额度、模型响应或质量。" : "保持演示模式，配置对应供应商凭据并使 web/worker 配置一致后重跑。"
    };
    console.log(JSON.stringify(output, null, 2));
    if (!report.ready) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("模型预检失败：请检查参数、环境文件与数据库连接；内部错误未输出。"); process.exitCode = 1; });
