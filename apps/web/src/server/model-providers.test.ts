import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createProvider, findProvidersByOrganization, updateProvider } from "./model-providers";

const testEncryptionKey = randomBytes(32);

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    modelProvider: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof createProvider>[0]["prisma"];
}

const provider = {
  id: "mp1", organizationId: "org1", ownerUserId: null,
  name: "My OpenAI", providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.openai.com/v1",
  encryptedApiKey: "***", authMode: "USER_KEY",
  protocol: "CHAT_COMPLETIONS", isDefault: false,
  status: "ACTIVE", createdAt: new Date(), updatedAt: new Date()
};

describe("model-providers", () => {
  describe("createProvider", () => {
    it("encrypts api key before storage", async () => {
      const prisma = mockPrisma({ modelProvider: { create: vi.fn().mockResolvedValue(provider) } });

      const result = await createProvider({
        organizationId: "org1", name: "My OpenAI",
        providerType: "OPENAI_COMPATIBLE", baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-secret-123", encryptionKey: testEncryptionKey, prisma
      });

      // 返回结果不应包含原始 key
      const createCallArgs = (prisma.modelProvider.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { data: { encryptedApiKey: string } } | undefined;
      expect(createCallArgs?.data.encryptedApiKey).not.toBe("sk-secret-123");
      expect(result.encryptedApiKey).toBe("***");
    });
  });

  describe("findProvidersByOrganization", () => {
    it("masks api keys in results", async () => {
      const prisma = mockPrisma({
        modelProvider: { findMany: vi.fn().mockResolvedValue([provider]) }
      });

      const results = await findProvidersByOrganization("org1", prisma);

      expect(results[0]!.encryptedApiKey).toBe("***");
    });
  });

  describe("updateProvider", () => {
    it("updates non-secret fields", async () => {
      const updated = { ...provider, name: "Renamed" };
      const prisma = mockPrisma({ modelProvider: { update: vi.fn().mockResolvedValue(updated) } });

      const result = await updateProvider("org1", "mp1", { name: "Renamed" }, prisma);

      expect(result.name).toBe("Renamed");
    });
  });
});
