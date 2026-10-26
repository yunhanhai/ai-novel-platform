// 客观文本度量：把"AI 味/文风质量"变成可计算、可复现的数字。
//
// 这些指标不依赖任何模型判断，任何人重跑得到同一结果——
// 评测基座的第一层（确定性层）。LLM 评审是第二层，必须建立在确定性层之上。

import { scanDeslop } from "../deslop/scanner";

export interface TextMetrics {
  /** 去空白后的字符数（与 computeWordCount 同口径） */
  charCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  /** 句长变异系数（stddev/mean）：AI 文本句长均匀 → 偏低；人类波动大 */
  sentenceLengthCv: number;
  paragraphCount: number;
  /** 对话行占比：trim 后以中文/英文引号或破折号起始的行 */
  dialogueLineRatio: number;
  /** 每千字 AI 味命中数（复用 deslop 扫描器的确定性词表/句式规则） */
  slopPer1kChars: number;
  /** 相邻重复 bigram 占比：第二个及以后出现的 bigram / 总 bigram 数（复读机检测） */
  repeatBigramRate: number;
}

const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g;

function countNonWhitespace(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?…]+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function sentenceLength(sentence: string): number {
  return sentence.replace(CJK_RE, "字").replace(/[^\p{L}\p{N}字]/gu, "").length;
}

function isDialogueLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[“”"「」『』—–-]/.test(trimmed);
}

function bigrams(text: string): string[] {
  const normalized = text.replace(/[\s，。！？、：；""''（）《》【】…—]/g, "");
  const result: string[] = [];
  for (let i = 0; i < normalized.length - 1; i += 1) {
    result.push(normalized.slice(i, i + 2));
  }
  return result;
}

export function computeTextMetrics(text: string): TextMetrics {
  const charCount = countNonWhitespace(text);
  if (charCount === 0) {
    return {
      charCount: 0,
      sentenceCount: 0,
      avgSentenceLength: 0,
      sentenceLengthCv: 0,
      paragraphCount: 0,
      dialogueLineRatio: 0,
      slopPer1kChars: 0,
      repeatBigramRate: 0
    };
  }

  const sentences = splitSentences(text);
  const lengths = sentences.map(sentenceLength).filter((n) => n > 0);
  const mean = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const variance =
    lengths.length > 0 ? lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length : 0;
  const stddev = Math.sqrt(variance);

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const dialogueLines = lines.filter(isDialogueLine).length;

  const slopHits = scanDeslop(text).issues.length;

  const grams = bigrams(text);
  const seen = new Set<string>();
  let repeats = 0;
  for (const gram of grams) {
    if (seen.has(gram)) repeats += 1;
    else seen.add(gram);
  }

  return {
    charCount,
    sentenceCount: sentences.length,
    avgSentenceLength: Math.round(mean * 100) / 100,
    sentenceLengthCv: mean > 0 ? Math.round((stddev / mean) * 1000) / 1000 : 0,
    paragraphCount: lines.length,
    dialogueLineRatio: lines.length > 0 ? Math.round((dialogueLines / lines.length) * 1000) / 1000 : 0,
    slopPer1kChars: Math.round((slopHits / charCount) * 1000 * 100) / 100,
    repeatBigramRate: grams.length > 0 ? Math.round((repeats / grams.length) * 1000) / 1000 : 0
  };
}

export interface MetricsAggregate {
  sampleCount: number;
  totalChars: number;
  meanOf: (key: keyof Omit<TextMetrics, "charCount">) => number;
}

// 汇总一批文本的指标均值（跳过空样本，避免除零）
export function aggregateMetrics(metricsList: TextMetrics[]): MetricsAggregate {
  const usable = metricsList.filter((m) => m.charCount > 0);
  const meanOf = (key: keyof Omit<TextMetrics, "charCount">): number => {
    if (usable.length === 0) return 0;
    const sum = usable.reduce((acc, m) => acc + m[key], 0);
    return Math.round((sum / usable.length) * 1000) / 1000;
  };
  return {
    sampleCount: usable.length,
    totalChars: usable.reduce((acc, m) => acc + m.charCount, 0),
    meanOf
  };
}
