import type { PrismaClient, Prisma } from "@ai-novel/db";

/**
 * ModelProfile 服务层 —— 与 model-providers.ts 风格一致，全部经 organizationId 隔离。
 * Profile 没有软删字段，DELETE 即物理删除（worker 路径会做 fallback 容错）。
 */

interface CreateProfileParams {
  organizationId: string;
  providerId: string;
  name: string;
  modelName: string;
  taskType: string;
  projectId?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  settings?: Prisma.InputJsonValue;
  prisma: PrismaClient;
}

interface UpdateProfileInput {
  name?: string;
  modelName?: string;
  taskType?: string;
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
  settings?: Prisma.InputJsonValue;
}

interface FindFilter {
  projectId?: string | null;
  taskType?: string;
}

export async function createProfile(params: CreateProfileParams) {
  const {
    organizationId, providerId, name, modelName, taskType, projectId,
    temperature, topP, maxOutputTokens, settings, prisma
  } = params;

  return prisma.modelProfile.create({
    data: {
      organizationId,
      providerId,
      name,
      modelName,
      taskType,
      ...(projectId ? { projectId } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
      ...(typeof topP === "number" ? { topP } : {}),
      ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
      ...(settings !== undefined ? { settings } : {})
    }
  });
}

export async function findProfilesByOrganization(
  organizationId: string,
  filter: FindFilter,
  prisma: PrismaClient
) {
  const where: Prisma.ModelProfileWhereInput = { organizationId };
  if (filter.projectId !== undefined) {
    where.projectId = filter.projectId;
  }
  if (filter.taskType) {
    where.taskType = filter.taskType;
  }

  return prisma.modelProfile.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
}

export async function findProfileById(
  organizationId: string,
  profileId: string,
  prisma: PrismaClient
) {
  return prisma.modelProfile.findFirst({
    where: { id: profileId, organizationId }
  });
}

export async function updateProfile(
  organizationId: string,
  profileId: string,
  data: UpdateProfileInput,
  prisma: PrismaClient
) {
  return prisma.modelProfile.update({
    where: { id: profileId, organizationId },
    data
  });
}

export async function softDeleteProfile(
  organizationId: string,
  profileId: string,
  prisma: PrismaClient
) {
  // schema 没有 deletedAt/status；物理删除
  return prisma.modelProfile.delete({
    where: { id: profileId, organizationId }
  });
}
