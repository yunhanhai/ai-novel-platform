import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createProvider,
  findProvidersByOrganization,
  updateProvider,
  findProviderById,
  softDeleteProvider,
  rotateApiKey
} from "./model-providers";

const testEncryptionKey = randomBytes(32);

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    modelProvider: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
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

  describe("findProviderById", () => {
    it("returns provider with masked key", async () => {
      const prisma = mockPrisma({
        modelProvider: { findFirst: vi.fn().mockResolvedValue({ ...provider, encryptedApiKey: "raw-encrypted" }) }
      });
      const result = await findProviderById("org1", "mp1", prisma);
      expect(result?.encryptedApiKey).toBe("***");
    });

    it("returns null when not found", async () => {
      const prisma = mockPrisma({
        modelProvider: { findFirst: vi.fn().mockResolvedValue(null) }
      });
      const result = await findProviderById("org1", "missing", prisma);
      expect(result).toBeNull();
    });
  });

  describe("softDeleteProvider", () => {
    it("sets status to DISABLED", async () => {
      const updateMock = vi.fn().mockResolvedValue({ ...provider, status: "DISABLED" });
      const prisma = mockPrisma({ modelProvider: { update: updateMock } });
      const result = await softDeleteProvider("org1", "mp1", prisma);
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DISABLED" } }));
      expect(result.status).toBe("DISABLED");
    });
  });

  describe("rotateApiKey", () => {
    it("re-encrypts and updates the api key", async () => {
      const updateMock = vi.fn().mockResolvedValue({ ...provider, encryptedApiKey: "new-encrypted" });
      const prisma = mockPrisma({ modelProvider: { update: updateMock } });
      const result = await rotateApiKey({
        organizationId: "org1", providerId: "mp1", apiKey: "sk-fresh",
        encryptionKey: testEncryptionKey, prisma
      });
      const call = updateMock.mock.calls[0]?.[0] as { data: { encryptedApiKey: string } };
      expect(call.data.encryptedApiKey).not.toBe("sk-fresh");
      expect(result.encryptedApiKey).toBe("***");
    });
  });
});
