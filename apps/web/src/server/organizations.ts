import type { PrismaClient } from "@ai-novel/db";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface CreateOrgParams {
  name: string;
  slug: string;
  ownerUserId: string;
  prisma: PrismaClient;
}

interface CreateOrgResult {
  organization: { id: string; name: string; slug: string };
  membership: { id: string; role: string };
}

interface AddMemberParams {
  organizationId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  prisma: PrismaClient;
}

export async function createOrganization({ name, slug, ownerUserId, prisma }: CreateOrgParams): Promise<CreateOrgResult> {
  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const organization = await tx.organization.create({
        data: { name, slug, ownerUserId, billingMode: "HYBRID", status: "ACTIVE" },
        select: { id: true, name: true, slug: true }
      });

      const membership = await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: ownerUserId,
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: new Date()
        },
        select: { id: true, role: true }
      });

      return { organization, membership };
    });
  } catch (error: unknown) {
    if (isPrismaUniqueError(error)) {
      throw new Error("组织标识已被占用");
    }
    throw error;
  }
}

export async function findOrganizationBySlug(slug: string, prisma: PrismaClient) {
  return prisma.organization.findUnique({ where: { slug } });
}

export async function findOrganizationsByUserId(userId: string, prisma: PrismaClient) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organization: true }
  });

  return memberships.map((m) => m.organization);
}

export async function addMember({ organizationId, userId, role, prisma }: AddMemberParams) {
  return prisma.organizationMember.create({
    data: {
      organizationId,
      userId,
      role,
      status: "ACTIVE",
      joinedAt: new Date()
    },
    select: { id: true, role: true }
  });
}

function isPrismaUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
}
