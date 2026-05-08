import type { PrismaClient } from "@ai-novel/db";
import { hashPassword } from "@ai-novel/shared/auth/password";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface CreateUserParams {
  email: string;
  displayName: string;
  password: string;
  prisma: PrismaClient;
}

interface CreateUserResult {
  user: { id: string; email: string; displayName: string };
  organization: { id: string; name: string; slug: string };
  membership: { id: string; role: string };
}

export async function findUserByEmail(email: string, prisma: PrismaClient) {
  return prisma.user.findFirst({ where: { email } });
}

export async function findUserById(id: string, prisma: PrismaClient) {
  return prisma.user.findUnique({ where: { id } });
}

export async function createUser({ email, displayName, password, prisma }: CreateUserParams): Promise<CreateUserResult> {
  const passwordHash = await hashPassword(password);
  const slug = email.split("@")[0] ?? email;

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.create({
        data: { email, displayName, passwordHash, status: "ACTIVE" },
        select: { id: true, email: true, displayName: true }
      });

      const organization = await tx.organization.create({
        data: {
          name: `${displayName} 的工作空间`,
          slug,
          ownerUserId: user.id,
          billingMode: "HYBRID",
          status: "ACTIVE"
        },
        select: { id: true, name: true, slug: true }
      });

      const membership = await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: new Date()
        },
        select: { id: true, role: true }
      });

      return { user, organization, membership };
    });
  } catch (error: unknown) {
    if (isPrismaUniqueError(error)) {
      throw new Error("该邮箱已被注册");
    }
    throw error;
  }
}

function isPrismaUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
}
