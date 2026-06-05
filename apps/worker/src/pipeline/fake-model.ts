import type { ModelGenerateOptions } from "@ai-novel/model-adapters";

export interface FakeModelConfig {
  outputText?: string;
  latencyMs?: number;
}

export interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const defaultText = `# 第一章

清晨的阳光穿过窗棂，落在案头那盏早已冷却的茶盏上。

林墨推开门，发现院子里多了一个陌生的身影。那人背对着她，正注视着墙角那棵枯了半边的老槐树。

"你是谁？"她问道，声音比预想中更镇定。

陌生人缓缓转过身来。他的眼神很深，像是藏着一个很长很长的故事。`;

export function createFakeModel(config: FakeModelConfig = {}) {
  const outputText = config.outputText ?? defaultText;
  const latencyMs = config.latencyMs ?? 0;

  async function generate(_prompt: string, _options?: ModelGenerateOptions): Promise<ModelResult> {
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }

    return {
      text: outputText,
      inputTokens: 250,
      outputTokens: outputText.length
    };
  }

  return { generate };
}

export type FakeModel = ReturnType<typeof createFakeModel>;
