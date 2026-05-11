export interface ResolverInput {
  organizationId: string;
  projectId: string;
  modelProfileId?: string | null;
  taskType: string;
}

type PrismaModelProfile = {
  findUnique: (args: { where: { id: string }; include: { provider: true } }) => Promise<unknown>;
  findFirst: (args: { where: Record<string, unknown>; include: { provider: true } }) => Promise<unknown>;
};

const includeProvider = { provider: true } as const;

export async function resolveModelProfile(
  input: ResolverInput,
  prisma: { modelProfile: PrismaModelProfile }
): Promise<Record<string, unknown> | null> {
  const taskKey = input.taskType.toLowerCase();

  // 1. 显式 modelProfileId
  if (input.modelProfileId) {
    const profile = await prisma.modelProfile.findUnique({
      where: { id: input.modelProfileId },
      include: includeProvider
    });
    if (profile) return profile as unknown as Record<string, unknown>;
  }

  // 2-5. 四级 fallback
  for (const condition of [
    { projectId: input.projectId, taskType: taskKey },
    { projectId: input.projectId, taskType: "default" },
    { projectId: null, organizationId: input.organizationId, taskType: taskKey },
    { projectId: null, organizationId: input.organizationId, taskType: "default" }
  ]) {
    const profile = await prisma.modelProfile.findFirst({
      where: condition,
      include: includeProvider
    });
    if (profile) return profile as unknown as Record<string, unknown>;
  }

  return null;
}
