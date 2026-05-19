import { describe, test, expect, vi, beforeEach } from "vitest";
import { resolveModelProfile } from "./model-resolver";

function mockProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-id-1",
    organizationId: "org-1",
    projectId: null as string | null,
    providerId: "prov-1",
    modelName: "gpt-4o-mini",
    taskType: "generate_chapter",
    temperature: null as number | null,
    topP: null as number | null,
    maxOutputTokens: null as number | null,
    provider: {
      id: "prov-1",
      providerType: "OPENAI_COMPATIBLE" as const,
      authMode: "PLATFORM_KEY" as const,
      baseUrl: null as string | null,
      encryptedApiKey: null as string | null
    },
    ...overrides
  };
}

function mockPrisma() {
  const findUnique = vi.fn();
  const findFirst = vi.fn();
  return {
    modelProfile: { findUnique, findFirst }
  };
}

describe("model-resolver", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  // Case 1: job.modelProfileId 显式命中
  test("returns profile directly when job.modelProfileId matches", async () => {
    const profile = mockProfile();
    prisma.modelProfile.findUnique.mockResolvedValue(profile);

    const result = await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: "profile-id-1",
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    expect(prisma.modelProfile.findUnique).toHaveBeenCalledWith({
      where: { id: "profile-id-1" },
      include: { provider: true }
    });
    expect(result?.id).toBe("profile-id-1");
    expect(prisma.modelProfile.findFirst).not.toHaveBeenCalled();
  });

  // Case 2: project + taskType (第2级)
  test("falls back to project + taskType when modelProfileId is null", async () => {
    const profile = mockProfile({ id: "proj-task", projectId: "proj-1", taskType: "generate_chapter" });
    prisma.modelProfile.findFirst.mockResolvedValue(profile);

    const result = await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: null,
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    expect(prisma.modelProfile.findFirst).toHaveBeenCalledWith({
      where: { projectId: "proj-1", taskType: "generate_chapter" },
      include: { provider: true }
    });
    expect(result?.id).toBe("proj-task");
    expect(prisma.modelProfile.findFirst).toHaveBeenCalledTimes(1);
  });

  // Case 3: project + default (第3级)
  test("falls back to project + default when project+taskType misses", async () => {
    prisma.modelProfile.findFirst
      .mockResolvedValueOnce(null) // project + taskType miss
      .mockResolvedValueOnce(mockProfile({ id: "proj-default", taskType: "default" })); // project + default hit

    const result = await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: null,
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    expect(result?.id).toBe("proj-default");
    expect(prisma.modelProfile.findFirst).toHaveBeenCalledTimes(2);
  });

  // Case 4: organization + taskType (第4级)
  test("falls back to organization + taskType when project-level misses completely", async () => {
    prisma.modelProfile.findFirst
      .mockResolvedValueOnce(null) // project + taskType
      .mockResolvedValueOnce(null) // project + default
      .mockResolvedValueOnce(mockProfile({ id: "org-task" })); // org + taskType hit

    const result = await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: null,
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    expect(result?.id).toBe("org-task");
    expect(prisma.modelProfile.findFirst).toHaveBeenCalledTimes(3);
    expect(prisma.modelProfile.findFirst).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ projectId: null, organizationId: "org-1", taskType: "generate_chapter" })
    }));
  });

  // Case 5: organization + default (第5级)
  test("returns organization + default as final fallback", async () => {
    prisma.modelProfile.findFirst
      .mockResolvedValueOnce(null) // project + taskType
      .mockResolvedValueOnce(null) // project + default
      .mockResolvedValueOnce(null) // org + taskType
      .mockResolvedValueOnce(mockProfile({ id: "org-default", taskType: "default" })); // org + default

    const result = await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: null,
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    expect(result?.id).toBe("org-default");
    expect(prisma.modelProfile.findFirst).toHaveBeenCalledTimes(4);
  });

  // Case 6: 全 miss → null
  test("returns null when no profile matches at any level", async () => {
    prisma.modelProfile.findFirst.mockResolvedValue(null);

    const result = await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: null,
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    expect(result).toBeNull();
    expect(prisma.modelProfile.findFirst).toHaveBeenCalledTimes(4);
  });

  // Case 7: taskType 大小写不敏感
  test("lowercases taskType in queries", async () => {
    prisma.modelProfile.findFirst.mockResolvedValue(mockProfile());

    await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: null,
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    // First call should have lowercased taskType
    expect(prisma.modelProfile.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ taskType: "generate_chapter" })
    }));
  });

  // Edge: modelProfileId 不存在也继续走 fallback 链
  test("continues to fallback chain when modelProfileId does not exist", async () => {
    prisma.modelProfile.findUnique.mockResolvedValue(null);
    prisma.modelProfile.findFirst.mockResolvedValue(mockProfile({ id: "fallback" }));

    const result = await resolveModelProfile({
      organizationId: "org-1",
      projectId: "proj-1",
      modelProfileId: "nonexistent",
      taskType: "GENERATE_CHAPTER"
    }, prisma);

    expect(result?.id).toBe("fallback");
    expect(prisma.modelProfile.findUnique).toHaveBeenCalled();
    expect(prisma.modelProfile.findFirst).toHaveBeenCalled();
  });
});
