import type { PrismaClient } from "@ai-novel/db";
import { encrypt, parseEncryptionKey } from "@ai-novel/shared/crypto/encryption";

interface CreateProviderParams {
  organizationId: string;
  name: string;
  providerType: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "CUSTOM";
  baseUrl?: string;
  apiKey: string;
  ownerUserId?: string;
  encryptionKey?: Buffer;
  prisma: PrismaClient;
}

interface UpdateProviderInput {
  name?: string;
  baseUrl?: string;
  isDefault?: boolean;
}

function getEncryptionKey(override?: Buffer): Buffer {
  const key = override ?? parseEncryptionKey(process.env.ENCRYPTION_KEY);
  if (!key || key.length !== 32) throw new Error("ENCRYPTION_KEY 必须为完整 64 位十六进制字符串");
  return key;
}

export async function createProvider(params: CreateProviderParams) {
  const { organizationId, name, providerType, baseUrl, apiKey, ownerUserId, encryptionKey, prisma } = params;
  const encryptedApiKey = await encrypt(apiKey, getEncryptionKey(encryptionKey));

  const provider = await prisma.modelProvider.create({
    data: {
      organizationId, name, providerType,
      encryptedApiKey,
      authMode: "USER_KEY",
      protocol: "AUTO",
      status: "ACTIVE",
      ...(baseUrl ? { baseUrl } : {}),
      ...(ownerUserId ? { ownerUserId } : {})
    }
  });

  return { ...provider, encryptedApiKey: "***" };
}

export async function findProvidersByOrganization(organizationId: string, prisma: PrismaClient) {
  const providers = await prisma.modelProvider.findMany({
    where: { organizationId, status: "ACTIVE" }
  });

  return providers.map((p) => ({ ...p, encryptedApiKey: "***" }));
}

export async function updateProvider(organizationId: string, providerId: string, data: UpdateProviderInput, prisma: PrismaClient) {
  const editable = { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}), ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}) };
  const provider = await prisma.modelProvider.update({
    where: { id: providerId, organizationId },
    data: editable
  });

  return { ...provider, encryptedApiKey: "***" };
}

export async function findProviderById(organizationId: string, providerId: string, prisma: PrismaClient) {
  const provider = await prisma.modelProvider.findFirst({
    where: { id: providerId, organizationId }
  });
  if (!provider) return null;
  return { ...provider, encryptedApiKey: "***" };
}

export async function softDeleteProvider(organizationId: string, providerId: string, prisma: PrismaClient) {
  const provider = await prisma.modelProvider.update({
    where: { id: providerId, organizationId },
    data: { status: "DISABLED" }
  });
  return { ...provider, encryptedApiKey: "***" };
}

interface RotateApiKeyParams {
  organizationId: string;
  providerId: string;
  apiKey: string;
  encryptionKey?: Buffer;
  prisma: PrismaClient;
}

export async function rotateApiKey(params: RotateApiKeyParams) {
  const { organizationId, providerId, apiKey, encryptionKey, prisma } = params;
  const encryptedApiKey = await encrypt(apiKey, getEncryptionKey(encryptionKey));
  const provider = await prisma.modelProvider.update({
    where: { id: providerId, organizationId },
    data: { encryptedApiKey }
  });
  return { ...provider, encryptedApiKey: "***" };
}
