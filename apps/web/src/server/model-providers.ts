import type { PrismaClient } from "@ai-novel/db";
import { encrypt } from "@ai-novel/shared/crypto/encryption";

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
  if (override) return override;
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
  }
  return Buffer.from(hex.slice(0, 64), "hex");
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
  const provider = await prisma.modelProvider.update({
    where: { id: providerId, organizationId },
    data
  });

  return { ...provider, encryptedApiKey: "***" };
}
