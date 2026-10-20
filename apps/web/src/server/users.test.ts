import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, findUserByEmail, findUserById } from "./users";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.DEFAULT_ORGANIZATION_ID;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn()
    },
    organization: {
      create: vi.fn()
    },
    organizationMember: {
      create: vi.fn()
    },
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma(overrides))),
    ...overrides
  } as unknown as Parameters<typeof createUser>[0]["prisma"];
}

describe("users", () => {
  describe("findUserByEmail", () => {
    it("returns user when email exists", async () => {
      const user = { id: "u1", email: "a@b.com", displayName: "Alice", status: "active", passwordHash: "hash" };
      const prisma = mockPrisma({ user: { findFirst: vi.fn().mockResolvedValue(user) } });

      const result = await findUserByEmail("a@b.com", prisma);

      expect(result).toBe(user);
    });

    it("returns null when email not found", async () => {
      const prisma = mockPrisma({ user: { findFirst: vi.fn().mockResolvedValue(null) } });

      const result = await findUserByEmail("nope@b.com", prisma);

      expect(result).toBeNull();
    });
  });

  describe("findUserById", () => {
    it("returns user when id exists", async () => {
      const user = { id: "u1", email: "a@b.com", displayName: "Alice", status: "active", passwordHash: "hash" };
      const prisma = mockPrisma({ user: { findUnique: vi.fn().mockResolvedValue(user) } });

      const result = await findUserById("u1", prisma);

      expect(result).toBe(user);
    });

    it("returns null when id not found", async () => {
      const prisma = mockPrisma({ user: { findUnique: vi.fn().mockResolvedValue(null) } });

      const result = await findUserById("unknown", prisma);

      expect(result).toBeNull();
    });
  });

  describe("createUser", () => {
    it("creates user and default organization in a transaction", async () => {
      const createdUser = {
        id: "u1", email: "a@b.com", displayName: "Alice", passwordHash: "hashed",
        avatarUrl: null, status: "active", locale: "zh-CN", timezone: "Asia/Shanghai",
        createdAt: new Date(), updatedAt: new Date()
      };
      const createdOrg = {
        id: "org1", name: "Alice 的工作空间", slug: "alice", planCode: "free",
        billingMode: "hybrid", ownerUserId: "u1", status: "active", settings: null,
        createdAt: new Date(), updatedAt: new Date()
      };
      const membership = {
        id: "m1", organizationId: "org1", userId: "u1", role: "owner",
        status: "active", joinedAt: new Date(), createdAt: new Date()
      };

      const prisma = mockPrisma({
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: vi.fn().mockResolvedValue(createdUser) },
            organization: { create: vi.fn().mockResolvedValue(createdOrg) },
            organizationMember: { create: vi.fn().mockResolvedValue(membership) },
            modelProvider: { findMany: vi.fn().mockResolvedValue([]) }
          };
          return cb(tx);
        })
      });

      const result = await createUser({
        email: "a@b.com",
        displayName: "Alice",
        password: "secret123",
        prisma
      });

      expect(result.user.id).toBe("u1");
      expect(result.organization.slug).toBeDefined();
      expect(result.membership.role).toBe("owner");
    });

    it("throws when email already exists", async () => {
      const duplicateError = new Error("Unique constraint failed") as Error & { code: string };
      duplicateError.code = "P2002";

      const prisma = mockPrisma({
        $transaction: vi.fn(async () => { throw duplicateError; })
      });

      await expect(
        createUser({ email: "dup@b.com", displayName: "Dup", password: "pw", prisma })
      ).rejects.toThrow("该邮箱已被注册");
    });

    it("clones starter model assets from the default organization", async () => {
      process.env.DEFAULT_ORGANIZATION_ID = "seed-org";

      const createdUser = {
        id: "u2", email: "clone@b.com", displayName: "Clone", passwordHash: "hashed",
        avatarUrl: null, status: "active", locale: "zh-CN", timezone: "Asia/Shanghai",
        createdAt: new Date(), updatedAt: new Date()
      };
      const createdOrg = {
        id: "org2", name: "Clone 的工作空间", slug: "clone", planCode: "free",
        billingMode: "hybrid", ownerUserId: "u2", status: "active", settings: null,
        createdAt: new Date(), updatedAt: new Date()
      };
      const membership = {
        id: "m2", organizationId: "org2", userId: "u2", role: "owner",
        status: "active", joinedAt: new Date(), createdAt: new Date()
      };
      const seedProvider = {
        id: "p1",
        organizationId: "seed-org",
        ownerUserId: null,
        name: "OpenAI 默认",
        providerType: "OPENAI_COMPATIBLE",
        baseUrl: "https://api.example.com/v1",
        encryptedApiKey: null,
        authMode: "PLATFORM_KEY",
        protocol: "AUTO",
        isDefault: true,
        status: "ACTIVE"
      };
      const seedProfile = {
        id: "mp1",
        organizationId: "seed-org",
        projectId: null,
        providerId: "p1",
        name: "默认档案",
        modelName: "gpt-seed",
        taskType: "default",
        temperature: null,
        topP: null,
        maxOutputTokens: null,
        settings: null
      };

      const providerCreate = vi.fn().mockResolvedValue({ id: "np1" });
      const profileCreate = vi.fn().mockResolvedValue({});
      const prisma = mockPrisma({
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: vi.fn().mockResolvedValue(createdUser) },
            organization: { create: vi.fn().mockResolvedValue(createdOrg) },
            organizationMember: { create: vi.fn().mockResolvedValue(membership) },
            modelProvider: {
              findMany: vi.fn().mockResolvedValue([seedProvider]),
              create: providerCreate
            },
            modelProfile: {
              findMany: vi.fn().mockResolvedValue([seedProfile]),
              create: profileCreate
            }
          };
          return cb(tx);
        })
      });

      const result = await createUser({
        email: "clone@b.com",
        displayName: "Clone",
        password: "secret123",
        prisma
      });

      expect(result.organization.id).toBe("org2");
      expect(providerCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org2",
          name: "OpenAI 默认",
          providerType: "OPENAI_COMPATIBLE",
          baseUrl: "https://api.example.com/v1",
          authMode: "PLATFORM_KEY",
          protocol: "AUTO",
          isDefault: true,
          status: "ACTIVE"
        })
      }));
      expect(profileCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org2",
          providerId: "np1",
          name: "默认档案",
          modelName: "gpt-seed",
          taskType: "default"
        })
      }));
    });

    it("skips cloning when the default organization matches the new one", async () => {
      const createdUser = { id: "u3", email: "same@b.com", displayName: "Same", passwordHash: "h" };
      const createdOrg = { id: "seed-org", name: "Same 的工作空间", slug: "same" };
      const membership = { id: "m3", organizationId: "seed-org", userId: "u3", role: "owner" };

      process.env.DEFAULT_ORGANIZATION_ID = "seed-org";

      const providerFindMany = vi.fn().mockResolvedValue([]);
      const prisma = mockPrisma({
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: vi.fn().mockResolvedValue(createdUser) },
            organization: { create: vi.fn().mockResolvedValue(createdOrg) },
            organizationMember: { create: vi.fn().mockResolvedValue(membership) },
            modelProvider: { findMany: providerFindMany }
          };
          return cb(tx);
        })
      });

      await createUser({ email: "same@b.com", displayName: "Same", password: "secret123", prisma });

      expect(providerFindMany).not.toHaveBeenCalled();
    });
  });
});
