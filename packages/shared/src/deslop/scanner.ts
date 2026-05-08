export interface DeslopIssue {
  category: string;
  severity: "info" | "warning" | "error";
  matched: string;
  position: { start: number; end: number };
  suggestion: string;
}

export interface DeslopStats {
  totalChars: number;
  totalWords: number;
  sentenceCount: number;
  estimatedTokens: number;
  avgSentenceLength: number;
}

export interface DeslopReport {
  issues: DeslopIssue[];
  stats: DeslopStats;
}

// 弱化副词——AI 高频修饰
const weakAdverbs = [
  "仿佛", "似乎", "好像", "隐约", "略微", "稍稍", "微微",
  "几乎", "差不多", "某种程度上", "其实", "大概", "或许",
  "莫名", "不由得", "不禁"
];

// 抽象名词三连结构（逗号、顿号 或 "和/与" 分隔）
const abstractNounTriples = /(?:价值|意义|生命|灵魂|命运|未来|世界|希望|信念|勇气|力量|永恒|自由|真理|梦想|现实|光明|黑暗)\s*[、，,和与]\s*(?:价值|意义|生命|灵魂|命运|未来|世界|希望|信念|勇气|力量|永恒|自由|真理|梦想|现实|光明|黑暗)\s*[、，,和与]\s*(?:价值|意义|生命|灵魂|命运|未来|世界|希望|信念|勇气|力量|永恒|自由|真理|梦想|现实|光明|黑暗)/;

// 套话——AI 模板句式
const stockPhrases = [
  "总而言之", "综上所述", "不难看出", "由此可见",
  "不禁感慨万分", "不禁让人感慨", "让人不禁感叹",
  "仿佛在诉说着什么", "似乎在等待着什么",
  "这不仅仅是一个", "更是对",
  "在这片广袤的土地上", "在这漫长的旅途中",
  "无论前方有多少", "只要心中有",
  "一切的", "仿佛一切", "似乎一切",
  "那是一种无法用言语形容的",
  "让人感受到了一种",
  "在这个瞬息万变的世界里",
  "随着时间一分一秒地流逝",
  "给人一种说不出的",
  "恍若隔世", "莫名的心", "心底泛起"
];

export function scanDeslop(text: string, customPatterns: string[] = []): DeslopReport {
  const issues: DeslopIssue[] = [];

  // 1. 弱化副词扫描
  for (const adverb of weakAdverbs) {
    let index = 0;
    while ((index = text.indexOf(adverb, index)) !== -1) {
      issues.push({
        category: "weak_adverb",
        severity: "warning",
        matched: adverb,
        position: { start: index, end: index + adverb.length },
        suggestion: `删除或替换 "${adverb}"，增强句子确定性`
      });
      index += adverb.length;
    }
  }

  // 2. 摘要句式扫描（过度总结）
  const summaryPattern = /这(不仅仅)?[是只].*的[证见体表显说]|[总终而]而言之/g;
  let match: RegExpExecArray | null;
  while ((match = summaryPattern.exec(text)) !== null) {
    issues.push({
      category: "summary_sentence",
      severity: "error",
      matched: match[0],
      position: { start: match.index, end: match.index + match[0].length },
      suggestion: "避免过度总结，改为展示具体细节"
    });
  }

  // 3. 抽象名词三连
  const tripleMatch = text.match(abstractNounTriples);
  if (tripleMatch) {
    issues.push({
      category: "abstract_noun_triple",
      severity: "warning",
      matched: tripleMatch[0],
      position: { start: tripleMatch.index ?? 0, end: (tripleMatch.index ?? 0) + tripleMatch[0].length },
      suggestion: "抽象名词堆砌削弱感染力，改为具体细节"
    });
  }

  // 4. 套话扫描
  for (const phrase of stockPhrases) {
    let index = 0;
    while ((index = text.indexOf(phrase, index)) !== -1) {
      issues.push({
        category: "stock_phrase",
        severity: "error",
        matched: phrase,
        position: { start: index, end: index + phrase.length },
        suggestion: `删除套话 "${phrase}"`
      });
      index += phrase.length;
    }
  }

  // 5. 同段落高频词重复
  const wordFreq = findRepeatedWords(text, 4);
  for (const { word, count } of wordFreq) {
    const pos = text.indexOf(word);
    issues.push({
      category: "repetition",
      severity: "info",
      matched: word,
      position: { start: pos, end: pos + word.length },
      suggestion: `"${word}" 在段落中出现 ${count} 次，建议替换或删减`
    });
  }

  // 6. 自定义规则
  for (const pattern of customPatterns) {
    let idx = 0;
    while ((idx = text.indexOf(pattern, idx)) !== -1) {
      issues.push({
        category: "custom",
        severity: "warning",
        matched: pattern,
        position: { start: idx, end: idx + pattern.length },
        suggestion: `自定义规则命中："${pattern}"`
      });
      idx += pattern.length;
    }
  }

  // 统计
  const sentences = text.split(/[。！？\n]/).filter((s) => s.trim().length > 0);
  const words = text.replace(/\s+/g, "").length;
  const stats: DeslopStats = {
    totalChars: text.length,
    totalWords: words,
    sentenceCount: sentences.length,
    estimatedTokens: Math.ceil(words / 2),
    avgSentenceLength: sentences.length > 0 ? Math.round(words / sentences.length) : 0
  };

  return { issues, stats };
}

function findRepeatedWords(text: string, threshold: number): { word: string; count: number }[] {
  // 移除标点，拆分中文为单字
  const chars = text.replace(/[^一-鿿]/g, "");
  const freq = new Map<string, number>();
  for (const ch of chars) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
