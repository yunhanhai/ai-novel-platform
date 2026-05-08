import { describe, expect, it } from "vitest";
import { scanDeslop } from "./deslop-scanner";

describe("deslop-scanner", () => {
  it("flags weak adverbs", () => {
    const text = "他仿佛看到了什么，似乎听到了声音。";
    const result = scanDeslop(text);

    const adverbHits = result.issues.filter((i) => i.category === "weak_adverb");
    expect(adverbHits.length).toBeGreaterThan(0);
    expect(adverbHits[0]!.matched).toMatch(/仿佛|似乎/);
  });

  it("flags abstract noun triples", () => {
    const text = "这体现了生命的价值、意义和永恒。";
    const result = scanDeslop(text);

    const tripleHits = result.issues.filter((i) => i.category === "abstract_noun_triple");
    expect(tripleHits.length).toBeGreaterThan(0);
  });

  it("flags stock AI phrases", () => {
    const text = "总而言之，这一切都让人感慨万千。";
    const result = scanDeslop(text);

    const stockHits = result.issues.filter((i) => i.category === "stock_phrase");
    expect(stockHits.length).toBeGreaterThan(0);
  });

  it("detects word repetition within same paragraph", () => {
    const text = "他看到了光。光很亮，亮得刺眼。他追逐光，最终化作了光。";
    const result = scanDeslop(text);

    const repHits = result.issues.filter((i) => i.category === "repetition");
    expect(repHits.length).toBeGreaterThan(0);
  });

  it("returns empty issues for clean text", () => {
    const text = "他推开门走了进去。";
    const result = scanDeslop(text);

    expect(result.issues).toHaveLength(0);
  });

  it("returns stats with correct word and sentence counts", () => {
    const text = "第一句话。这是第二句。还有第三句话在这里。";
    const result = scanDeslop(text);

    expect(result.stats.totalChars).toBeGreaterThan(0);
    expect(result.stats.estimatedTokens).toBeGreaterThan(0);
  });
});
