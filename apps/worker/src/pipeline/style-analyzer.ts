// 风格统计引擎：纯函数从中文文本计算可写入 style_profiles 的统计字段

export interface SentenceLengthProfile {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
}

export interface ParagraphLengthProfile {
  avg: number;
  min: number;
  max: number;
}

export interface WordFreq {
  word: string;
  count: number;
}

export interface StyleStats {
  totalChars: number;
  sentenceCount: number;
  paragraphCount: number;
  sentenceLengthProfile: SentenceLengthProfile;
  paragraphLengthProfile: ParagraphLengthProfile;
  dialogueRatio: number;       // 0-1，对白字符 / 全文字符
  descriptionDensity: number;  // 0-1，描写密度启发式
  topWords: WordFreq[];        // 高频中文单字 Top 20
}

const sentenceSeparator = /[。！？!?]/;
const paragraphSeparator = /\n+/;
const chineseChar = /[一-鿿]/;

// 中文常见虚词，统计高频词时排除
const stopChars = new Set([
  "的", "了", "是", "在", "有", "和", "也", "就", "都", "而", "及", "與", "或",
  "他", "她", "它", "你", "我", "们", "这", "那", "之", "其", "于", "以", "为",
  "一", "个", "上", "下", "不", "中", "里", "着", "过", "去", "来", "到", "被",
  "把", "对", "向", "从", "时", "地", "得"
]);

export function analyzeStyle(text: string): StyleStats {
  const cleanText = text.trim();
  if (cleanText.length === 0) {
    return emptyStats();
  }

  const sentences = splitSentences(cleanText);
  const paragraphs = splitParagraphs(cleanText);
  const sentenceLengths = sentences.map((s) => countChineseChars(s));
  const paragraphLengths = paragraphs.map((p) => countChineseChars(p));

  return {
    totalChars: countChineseChars(cleanText),
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    sentenceLengthProfile: profileNumbers(sentenceLengths),
    paragraphLengthProfile: {
      avg: average(paragraphLengths),
      min: paragraphLengths.length > 0 ? Math.min(...paragraphLengths) : 0,
      max: paragraphLengths.length > 0 ? Math.max(...paragraphLengths) : 0
    },
    dialogueRatio: computeDialogueRatio(cleanText),
    descriptionDensity: computeDescriptionDensity(cleanText),
    topWords: computeTopWords(cleanText, 20)
  };
}

// 聚合多份参考文本：按字符数加权合并各项指标
export function analyzeMultipleTexts(texts: string[]): StyleStats {
  if (texts.length === 0) return emptyStats();
  if (texts.length === 1) return analyzeStyle(texts[0]!);

  const stats = texts.map(analyzeStyle);
  const totalChars = stats.reduce((s, x) => s + x.totalChars, 0) || 1;

  const weighted = (key: keyof Pick<StyleStats, "dialogueRatio" | "descriptionDensity">) =>
    stats.reduce((s, x) => s + x[key] * (x.totalChars / totalChars), 0);

  const allSentenceLengths = stats.flatMap((x, i) =>
    Array(Math.max(1, x.sentenceCount)).fill(x.sentenceLengthProfile.avg) as number[]
  );

  const wordMap = new Map<string, number>();
  for (const stat of stats) {
    for (const w of stat.topWords) {
      wordMap.set(w.word, (wordMap.get(w.word) ?? 0) + w.count);
    }
  }
  const topWords = [...wordMap.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    totalChars,
    sentenceCount: stats.reduce((s, x) => s + x.sentenceCount, 0),
    paragraphCount: stats.reduce((s, x) => s + x.paragraphCount, 0),
    sentenceLengthProfile: profileNumbers(allSentenceLengths),
    paragraphLengthProfile: {
      avg: Math.round(average(stats.map((x) => x.paragraphLengthProfile.avg))),
      min: Math.min(...stats.map((x) => x.paragraphLengthProfile.min)),
      max: Math.max(...stats.map((x) => x.paragraphLengthProfile.max))
    },
    dialogueRatio: round2(weighted("dialogueRatio")),
    descriptionDensity: round2(weighted("descriptionDensity")),
    topWords
  };
}

function emptyStats(): StyleStats {
  return {
    totalChars: 0,
    sentenceCount: 0,
    paragraphCount: 0,
    sentenceLengthProfile: { avg: 0, min: 0, max: 0, p50: 0, p90: 0 },
    paragraphLengthProfile: { avg: 0, min: 0, max: 0 },
    dialogueRatio: 0,
    descriptionDensity: 0,
    topWords: []
  };
}

function splitSentences(text: string): string[] {
  return text
    .split(sentenceSeparator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(paragraphSeparator)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function countChineseChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (chineseChar.test(ch)) n++;
  }
  return n;
}

function profileNumbers(values: number[]): SentenceLengthProfile {
  if (values.length === 0) {
    return { avg: 0, min: 0, max: 0, p50: 0, p90: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: Math.round(average(values)),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9)
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, x) => s + x, 0) / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

// 对白比例：识别中文弯引号 “..” / 直引号 "..." / 「...」 / 『...』 内字符
function computeDialogueRatio(text: string): number {
  const total = countChineseChars(text);
  if (total === 0) return 0;

  const dialoguePatterns = [
    /[“”][^“”]*[“”]/g,
    /"[^"]*"/g,
    /「[^」]*」/g,
    /『[^』]*』/g
  ];

  let dialogueChars = 0;
  for (const pattern of dialoguePatterns) {
    const matches = text.match(pattern) ?? [];
    for (const m of matches) {
      dialogueChars += countChineseChars(m);
    }
  }
  return round2(Math.min(1, dialogueChars / total));
}

// 描写密度启发式：标点密度越低、平均句长越长，描写密度越高
function computeDescriptionDensity(text: string): number {
  const chars = countChineseChars(text);
  if (chars === 0) return 0;
  const punctuation = (text.match(/[，、。！？；：]/g) ?? []).length;
  const punctRatio = punctuation / chars;
  // 经验映射：punctRatio 0.05 → density 0.9，punctRatio 0.25 → density 0.1
  const density = Math.max(0, Math.min(1, 1 - punctRatio * 4));
  return round2(density);
}

function computeTopWords(text: string, limit: number): WordFreq[] {
  const freq = new Map<string, number>();
  for (const ch of text) {
    if (!chineseChar.test(ch)) continue;
    if (stopChars.has(ch)) continue;
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  return [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
