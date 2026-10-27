import { describe, expect, it, vi } from "vitest";
import { buildJudgePrompt, createPairwiseJudge, parseJudgement } from "./judge";
import { EVAL_RUBRIC } from "@ai-novel/shared/eval/rubric";

const TEXT_A = "他推开门，屋里落满灰尘。";
const TEXT_B = "门开了。灰尘扑面而来。";

function judgeModelReturning(text: string) {
  return { generate: vi.fn().mockResolvedValue({ text }) };
}

const VALID_JSON = JSON.stringify({
  winner: "A",
  perDimension: { prose: "A", coherence: "tie", characterVoice: "B", pacing: "A", hook: "tie" },
  reasons: ["A 的动作细节更具体"]
});

describe("buildJudgePrompt", () => {
  it("includes both texts and all rubric dimensions", () => {
    const prompt = buildJudgePrompt(EVAL_RUBRIC, TEXT_A, TEXT_B);
    expect(prompt).toContain("版本 A");
    expect(prompt).toContain(TEXT_A);
    expect(prompt).toContain("版本 B");
    expect(prompt).toContain(TEXT_B);
    for (const dimension of EVAL_RUBRIC) {
      expect(prompt).toContain(dimension.label);
    }
    // 消除位置偏好的关键：随机化不可依赖，prompt 明确要求 tie 而不强行分高下
    expect(prompt).toContain("tie");
  });
});

describe("parseJudgement", () => {
  it("parses a valid judgement", () => {
    const result = parseJudgement(VALID_JSON, EVAL_RUBRIC);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe("A");
    expect(result!.perDimension.prose).toBe("A");
    expect(result!.perDimension.hook).toBe("tie");
    expect(result!.reasons).toHaveLength(1);
    expect(result!.unstable).toBe(false);
  });

  it("strips markdown fences before parsing", () => {
    const result = parseJudgement("```json\n" + VALID_JSON + "\n```", EVAL_RUBRIC);
    expect(result!.winner).toBe("A");
  });

  it("returns null for an invalid winner", () => {
    expect(parseJudgement('{"winner":"C"}', EVAL_RUBRIC)).toBeNull();
  });

  it("returns null for non-JSON text", () => {
    expect(parseJudgement("两个版本差不多", EVAL_RUBRIC)).toBeNull();
  });

  it("defaults unknown dimension values to tie", () => {
    const result = parseJudgement(
      JSON.stringify({ winner: "B", perDimension: { prose: "bogus" } }),
      EVAL_RUBRIC
    );
    expect(result!.perDimension.prose).toBe("tie");
    // 未给出的维度同样落 tie
    expect(result!.perDimension.hook).toBe("tie");
  });
});

describe("createPairwiseJudge", () => {
  it("returns the forward verdict when the swap test agrees", async () => {
    // 第一次 (A,B) 顺序：A 赢；第二次 (B,A) 顺序：位置上的 B 赢 = 原位 A 赢 → 结论一致
    const swapped = JSON.stringify({
      winner: "B",
      perDimension: { prose: "B", coherence: "tie", characterVoice: "A", pacing: "B", hook: "tie" },
      reasons: ["A 的动作细节更具体"]
    });
    const model = judgeModelReturning(VALID_JSON);
    model.generate.mockResolvedValueOnce({ text: VALID_JSON }).mockResolvedValueOnce({ text: swapped });
    const judge = createPairwiseJudge({ model });

    const result = await judge(TEXT_A, TEXT_B);

    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(result.winner).toBe("A");
    expect(result.unstable).toBe(false);
  });

  it("marks unstable and returns tie when the swap test contradicts", async () => {
    // 交换顺序后仍说位置上的 A 赢（= 原位 B 赢）→ 与第一次矛盾
    const model = judgeModelReturning(VALID_JSON);
    const judge = createPairwiseJudge({ model });

    const result = await judge(TEXT_A, TEXT_B);

    expect(result.winner).toBe("tie");
    expect(result.unstable).toBe(true);
  });

  it("returns a stable fallback when the model returns garbage", async () => {
    const model = judgeModelReturning("我觉得差不多");
    const judge = createPairwiseJudge({ model });

    const result = await judge(TEXT_A, TEXT_B);

    expect(result.winner).toBe("tie");
    expect(result.unstable).toBe(true);
  });
});
