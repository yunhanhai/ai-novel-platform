import type { PrismaClient } from "@ai-novel/db";
import { Prisma } from "@ai-novel/db";
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

async function cloneStarterModelAssets(tx: Tx, targetOrgId: string, sourceOrgId: string | null) {
  if (!sourceOrgId || sourceOrgId === targetOrgId) return;

  const providers = await tx.modelProvider.findMany({
    where: { organizationId: sourceOrgId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" }
  });

  for (const provider of providers) {
    const clonedProvider = await tx.modelProvider.create({
      data: {
        organizationId: targetOrgId,
        name: provider.name,
        providerType: provider.providerType,
        baseUrl: provider.baseUrl,
        encryptedApiKey: provider.encryptedApiKey,
        authMode: provider.authMode,
        protocol: provider.protocol,
        isDefault: provider.isDefault,
        status: provider.status
      },
      select: { id: true }
    });

    const profiles = await tx.modelProfile.findMany({
      where: { organizationId: sourceOrgId, projectId: null, providerId: provider.id },
      orderBy: { createdAt: "asc" }
    });

    for (const profile of profiles) {
      await tx.modelProfile.create({
        data: {
          organizationId: targetOrgId,
          providerId: clonedProvider.id,
          name: profile.name,
          modelName: profile.modelName,
          taskType: profile.taskType,
          temperature: profile.temperature,
          topP: profile.topP,
          maxOutputTokens: profile.maxOutputTokens,
          settings: profile.settings ?? Prisma.JsonNull
        }
      });
    }
  }
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

      const sourceOrgId = process.env.DEFAULT_ORGANIZATION_ID?.trim() || null;
      await cloneStarterModelAssets(tx, organization.id, sourceOrgId);

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
