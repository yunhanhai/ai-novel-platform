import { describe, expect, it } from "vitest";
import {
  addMember,
  createOrganization,
  findOrganizationBySlug,
  findOrganizationsByUserId
} from "./organizations";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    organization: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn()
    },
    organizationMember: {
      create: vi.fn(),
      findMany: vi.fn()
    },
    ...overrides
  } as unknown as Parameters<typeof createOrganization>[0]["prisma"];
}

const org = { id: "org1", name: "My Org", slug: "my-org" };
const ownerUser = { id: "u1" };

describe("organizations", () => {
  describe("createOrganization", () => {
    it("creates org and adds owner membership in transaction", async () => {
      const membership = { id: "m1", organizationId: "org1", userId: "u1", role: "owner" };
      const prisma = mockPrisma({
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            organization: { create: vi.fn().mockResolvedValue(org) },
            organizationMember: { create: vi.fn().mockResolvedValue(membership) }
          };
          return cb(tx);
        })
      });

      const result = await createOrganization({
        name: "My Org",
        slug: "my-org",
        ownerUserId: "u1",
        prisma
      });

      expect(result.organization.name).toBe("My Org");
      expect(result.membership.role).toBe("owner");
    });

    it("throws on duplicate slug", async () => {
      const dupError = new Error("Unique constraint") as Error & { code: string };
      dupError.code = "P2002";

      const prisma = mockPrisma({
        $transaction: vi.fn(async () => { throw dupError; })
      });

      await expect(
        createOrganization({ name: "X", slug: "dup", ownerUserId: "u1", prisma })
      ).rejects.toThrow("组织标识已被占用");
    });
  });

  describe("findOrganizationBySlug", () => {
    it("returns org when slug matches", async () => {
      const prisma = mockPrisma({ organization: { findUnique: vi.fn().mockResolvedValue(org) } });

      const result = await findOrganizationBySlug("my-org", prisma);

      expect(result).toBe(org);
    });
  });

  describe("findOrganizationsByUserId", () => {
    it("returns orgs for a user via memberships", async () => {
      const memberships = [
        { organizationId: "org1", organization: org },
        { organizationId: "org2", organization: { id: "org2", name: "Org 2", slug: "org-2" } }
      ];
      const prisma = mockPrisma({
        organizationMember: { findMany: vi.fn().mockResolvedValue(memberships) }
      });

      const result = await findOrganizationsByUserId("u1", prisma);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("My Org");
    });
  });

  describe("addMember", () => {
    it("adds a member to an organization", async () => {
      const membership = { id: "m2", organizationId: "org1", userId: "u2", role: "member" };
      const prisma = mockPrisma({
        organizationMember: { create: vi.fn().mockResolvedValue(membership) }
      });

      const result = await addMember({
        organizationId: "org1",
        userId: "u2",
        role: "MEMBER" as const,
        prisma
      });

      expect(result.role).toBe("member");
    });
  });
});
