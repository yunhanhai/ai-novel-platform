import { decrypt, parseEncryptionKey } from "@ai-novel/shared/crypto/encryption";

type Env = Record<string, string | undefined>;
export interface ReadinessProvider {
  id: string;
  organizationId: string;
  providerType: string;
  authMode: string;
  status: string;
  baseUrl: string | null;
  encryptedApiKey: string | null;
}
export interface ReadinessProfile {
  id: string;
  organizationId: string;
  projectId: string | null;
  providerId: string;
  modelName: string;
}

export function assessModelReadiness(input: {
  workerEnv: Env;
  webEnv: Env;
  providers: ReadinessProvider[];
  profiles: ReadinessProfile[];
}) {
  const issues: string[] = [];
  if (input.workerEnv.USE_FAKE_MODEL === "true") issues.push("WORKER_FAKE_MODE");
  if (input.webEnv.USE_FAKE_MODEL === "true") issues.push("WEB_FAKE_MODE");
  if (!input.profiles.length) issues.push("NO_MODEL_PROFILE");
  const providers = new Map(input.providers.map(p => [p.id, p]));
  const checks = input.profiles.map(profile => {
    const problems: string[] = [];
    const provider = providers.get(profile.providerId);
    if (!profile.modelName.trim()) problems.push("MODEL_NAME_MISSING");
    if (!provider) problems.push("PROVIDER_MISSING");
    else {
      if (provider.status !== "ACTIVE") problems.push("PROVIDER_DISABLED");
      if (provider.organizationId !== profile.organizationId) problems.push("PROVIDER_ORGANIZATION_MISMATCH");
      if (!["OPENAI_COMPATIBLE", "ANTHROPIC", "DEEPSEEK", "CUSTOM"].includes(provider.providerType)) problems.push("PROVIDER_UNSUPPORTED");
      if (provider.baseUrl) {
        try { if (!["http:", "https:"].includes(new URL(provider.baseUrl).protocol)) problems.push("BASE_URL_INVALID"); }
        catch { problems.push("BASE_URL_INVALID"); }
      }
      if (provider.authMode === "USER_KEY") {
        if (!provider.encryptedApiKey) problems.push("STORED_API_KEY_MISSING");
        const workerKey = parseEncryptionKey(input.workerEnv.ENCRYPTION_KEY);
        const webKey = parseEncryptionKey(input.webEnv.ENCRYPTION_KEY);
        if (!workerKey) problems.push("WORKER_ENCRYPTION_KEY_INVALID");
        if (!webKey) problems.push("WEB_ENCRYPTION_KEY_INVALID");
        if (workerKey && webKey && !workerKey.equals(webKey)) problems.push("ENCRYPTION_KEY_MISMATCH");
      } else if (provider.authMode === "PLATFORM_KEY") {
        const keyName = provider.providerType === "ANTHROPIC" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
        if (!input.workerEnv[keyName]?.trim()) problems.push("WORKER_API_KEY_MISSING");
        if (!input.webEnv[keyName]?.trim()) problems.push("WEB_API_KEY_MISSING");
        if (input.workerEnv[keyName] && input.webEnv[keyName] && input.workerEnv[keyName] !== input.webEnv[keyName]) problems.push("PLATFORM_API_KEY_MISMATCH");
      } else problems.push("AUTH_MODE_INVALID");
    }
    return { profileId: profile.id, organizationId: profile.organizationId, projectId: profile.projectId,
      providerId: profile.providerId, modelName: profile.modelName, ready: problems.length === 0, issues: problems };
  });
  return { ready: issues.length === 0 && checks.some(c => c.ready), issues, checks,
    scope: "local configuration only; no HTTP request or database write" };
}

export async function canDecryptStoredCredential(ciphertext: string | null, workerValue: string | undefined, webValue: string | undefined): Promise<boolean> {
  const workerKey = parseEncryptionKey(workerValue);
  const webKey = parseEncryptionKey(webValue);
  if (!ciphertext || !workerKey || !webKey) return false;
  try {
    const [workerKeyText, webKeyText] = await Promise.all([decrypt(ciphertext, workerKey), decrypt(ciphertext, webKey)]);
    return workerKeyText.trim().length > 0 && workerKeyText === webKeyText;
  } catch { return false; }
}
export function buildReadinessProfileFilter(
  selection: { organizationId?: string; projectId?: string; id?: string },
  project?: { id: string; organizationId: string } | null
): Record<string, unknown> {
  if (!selection.projectId) return { ...selection };
  if (!project || project.id !== selection.projectId || (selection.organizationId && selection.organizationId !== project.organizationId)) {
    throw new Error("预检项目不存在或不属于指定组织");
  }
  return { ...(selection.id ? { id: selection.id } : {}), organizationId: project.organizationId,
    OR: [{ projectId: project.id }, { projectId: null }] };
}