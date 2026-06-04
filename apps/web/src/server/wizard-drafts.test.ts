import { describe, expect, it, vi, beforeEach } from "vitest";

const resolveModelProfileMock = vi.fn();
const createAdapterMock = vi.fn();

vi.mock("@ai-novel/model-adapters", () => ({
  resolveModelProfile: (...args: unknown[]) => resolveModelProfileMock(...args),
  createAdapter: (...args: unknown[]) => createAdapterMock(...args)
}));

import { draftPremise, draftOutline } from "./wizard-drafts";

const ENC_KEY_HEX = "A".repeat(64);

function fakeAdapter(text: string) {
  return {
    modelName: "mock",
    providerType: "OPENAI_COMPATIBLE",
    generate: vi.fn(async () => ({ text, inputTokens: 1, outputTokens: 1 }))
  };
}

function slowAdapter(delayMs: number, text = "slow") {
  return {
    modelName: "mock",
    providerType: "OPENAI_COMPATIBLE",
    generate: vi.fn(
      () =>
        new Promise<{ text: string; inputTokens: number; outputTokens: number }>(
          (resolve) => {
            setTimeout(() => resolve({ text, inputTokens: 1, outputTokens: 1 }), delayMs);
          }
        )
    )
  };
}

function buildDeps(env: Partial<NodeJS.ProcessEnv> = {}) {
  return {
    prisma: {} as never,
    organizationId: "org-1",
    projectId: "proj-1",
    env: env as NodeJS.ProcessEnv
  };
}

describe("draftPremise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("fake 模式返回拼接占位文本且 degraded=false", async () => {
    const result = await draftPremise(
      { projectTitle: "星河彼岸", genreTags: ["奇幻"], styleTags: ["热血"], oneLiner: "少年觉醒" },
      buildDeps({ USE_FAKE_MODEL: "true" })
    );

    expect(result.degraded).toBe(false);
    expect(result.text).toContain("星河彼岸");
    expect(result.text).toContain("奇幻");
    expect(result.text).toContain("少年觉醒");
    expect(resolveModelProfileMock).not.toHaveBeenCalled();
  });

  it("PLATFORM_KEY 真实模式未配 ENCRYPTION_KEY 仍可使用环境 key", async () => {
    resolveModelProfileMock.mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", baseUrl: null, encryptedApiKey: null },
      modelName: "gpt-5.5"
    });
    createAdapterMock.mockResolvedValue(fakeAdapter("平台 key 真实输出"));

    const env = { USE_FAKE_MODEL: "false", OPENAI_API_KEY: "sk-openai-test" };
    const result = await draftPremise(
      { projectTitle: "X" },
      buildDeps(env)
    );

    expect(result.degraded).toBe(false);
    expect(result.text).toBe("平台 key 真实输出");
    expect(resolveModelProfileMock).toHaveBeenCalled();
    expect(createAdapterMock).toHaveBeenCalledWith(
      expect.anything(),
      "gpt-5.5",
      expect.objectContaining({ encryptionKey: null, env })
    );
  });

  it("USER_KEY 真实模式未配 ENCRYPTION_KEY 时降级 fake 并 degraded=true", async () => {
    resolveModelProfileMock.mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "USER_KEY", baseUrl: null, encryptedApiKey: "enc-key" },
      modelName: "gpt-5.5"
    });

    const result = await draftPremise(
      { projectTitle: "X" },
      buildDeps({ USE_FAKE_MODEL: "false" })
    );

    expect(result.degraded).toBe(true);
    expect(result.text).toContain("X");
    expect(resolveModelProfileMock).toHaveBeenCalled();
    expect(createAdapterMock).not.toHaveBeenCalled();
  });

  it("真实模式 resolveModelProfile 返回 null 时降级", async () => {
    resolveModelProfileMock.mockResolvedValue(null);

    const result = await draftPremise(
      { projectTitle: "X" },
      buildDeps({ USE_FAKE_MODEL: "false", ENCRYPTION_KEY: ENC_KEY_HEX })
    );

    expect(result.degraded).toBe(true);
    expect(resolveModelProfileMock).toHaveBeenCalled();
    expect(createAdapterMock).not.toHaveBeenCalled();
  });

  it("真实模式 adapter.generate 抛错时降级", async () => {
    resolveModelProfileMock.mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", baseUrl: null, encryptedApiKey: null },
      modelName: "gpt-4o-mini"
    });
    createAdapterMock.mockResolvedValue({
      modelName: "gpt-4o-mini",
      providerType: "OPENAI_COMPATIBLE",
      generate: vi.fn(async () => {
        throw new Error("upstream error");
      })
    });

    const result = await draftPremise(
      { projectTitle: "X" },
      buildDeps({ USE_FAKE_MODEL: "false", ENCRYPTION_KEY: ENC_KEY_HEX })
    );

    expect(result.degraded).toBe(true);
  });

  it("真实模式成功生成返回 LLM 文本且 degraded=false", async () => {
    resolveModelProfileMock.mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", baseUrl: null, encryptedApiKey: null },
      modelName: "gpt-4o-mini"
    });
    createAdapterMock.mockResolvedValue(fakeAdapter("LLM 真实输出"));

    const result = await draftPremise(
      { projectTitle: "X" },
      buildDeps({ USE_FAKE_MODEL: "false", ENCRYPTION_KEY: ENC_KEY_HEX })
    );

    expect(result.degraded).toBe(false);
    expect(result.text).toBe("LLM 真实输出");
  });

  it("真实模式超时降级", async () => {
    vi.useFakeTimers();
    resolveModelProfileMock.mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", baseUrl: null, encryptedApiKey: null },
      modelName: "gpt-4o-mini"
    });
    createAdapterMock.mockResolvedValue(slowAdapter(60_000));

    const pending = draftPremise(
      { projectTitle: "Slow" },
      buildDeps({ USE_FAKE_MODEL: "false", ENCRYPTION_KEY: ENC_KEY_HEX })
    );

    await vi.advanceTimersByTimeAsync(26_000);
    const result = await pending;

    expect(result.degraded).toBe(true);
    expect(result.text).toContain("Slow");
  });
});

describe("draftOutline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("fake 模式返回方法论骨架且 degraded=false", async () => {
    const result = await draftOutline(
      { methodType: "three_act", genreTags: ["奇幻"] },
      buildDeps({ USE_FAKE_MODEL: "true" })
    );

    expect(result.degraded).toBe(false);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.every((n) => ["BOOK", "VOLUME", "CHAPTER", "BEAT"].includes(n.level))).toBe(true);
    expect(result.nodes[0]?.title).toBeTruthy();
    expect(result.nodes[0]?.orderIndex).toBe(0);
  });

  it("fake 模式 summary 注入 genre/style 元素", async () => {
    const result = await draftOutline(
      { methodType: "three_act", genreTags: ["奇幻"], styleTags: ["热血"] },
      buildDeps({ USE_FAKE_MODEL: "true" })
    );

    expect(result.nodes[0]?.summary).toContain("奇幻");
    expect(result.nodes[0]?.summary).toContain("热血");
  });

  it("真实模式按行解析 LLM 输出", async () => {
    resolveModelProfileMock.mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", baseUrl: null, encryptedApiKey: null },
      modelName: "gpt-4o-mini"
    });
    createAdapterMock.mockResolvedValue(
      fakeAdapter("0|新世界 setup\n1|第一推力强烈\n2|主角进入未知")
    );

    const result = await draftOutline(
      { methodType: "three_act" },
      buildDeps({ USE_FAKE_MODEL: "false", ENCRYPTION_KEY: ENC_KEY_HEX })
    );

    expect(result.degraded).toBe(false);
    expect(result.nodes[0]?.summary).toBe("新世界 setup");
    expect(result.nodes[1]?.summary).toBe("第一推力强烈");
    expect(result.nodes[2]?.summary).toBe("主角进入未知");
  });

  it("真实模式失败时降级到 fake 骨架", async () => {
    resolveModelProfileMock.mockResolvedValue(null);

    const result = await draftOutline(
      { methodType: "three_act" },
      buildDeps({ USE_FAKE_MODEL: "false", ENCRYPTION_KEY: ENC_KEY_HEX })
    );

    expect(result.degraded).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it("真实模式超时降级到 fake 骨架", async () => {
    vi.useFakeTimers();
    resolveModelProfileMock.mockResolvedValue({
      provider: { providerType: "OPENAI_COMPATIBLE", authMode: "PLATFORM_KEY", baseUrl: null, encryptedApiKey: null },
      modelName: "gpt-4o-mini"
    });
    createAdapterMock.mockResolvedValue(slowAdapter(60_000));

    const pending = draftOutline(
      { methodType: "three_act" },
      buildDeps({ USE_FAKE_MODEL: "false", ENCRYPTION_KEY: ENC_KEY_HEX })
    );

    await vi.advanceTimersByTimeAsync(26_000);
    const result = await pending;

    expect(result.degraded).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});
