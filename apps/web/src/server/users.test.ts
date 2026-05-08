import { describe, expect, it } from "vitest";
import { createUser, findUserByEmail, findUserById } from "./users";

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
            organizationMember: { create: vi.fn().mockResolvedValue(membership) }
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
  });
});
