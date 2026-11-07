// 轻量文本差异：中文按字符、英文按词切分，用最长公共子序列回溯出差异段。
// 用途有两处：版本对比的 UI 展示，以及评测管线的修改幅度统计。
// 先剥离完全相同的前后文；变化区域超过阈值时只粗化该区域。

export type DiffKind = "equal" | "insert" | "delete";

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

const MAX_UNITS = 4000;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const regex = /[\u4e00-\u9fff]|[A-Za-z0-9]+|[^\s]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

function coarseDiff(before: string, after: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  if (before) segments.push({ kind: "delete", text: before });
  if (after) segments.push({ kind: "insert", text: after });
  return segments.length > 0 ? segments : [{ kind: "equal", text: "" }];
}

export function diffText(before: string, after: string): DiffSegment[] {
  if (before === after) return [{ kind: "equal", text: before }];

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  // Do not separate the two UTF16 units of a Unicode code point.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) { endBefore++; endAfter++; }
  const prefix = before.slice(0, start), suffix = before.slice(endBefore);
  const middle = diffChangedText(before.slice(start, endBefore), after.slice(start, endAfter));
  const segments: DiffSegment[] = [];
  for (const segment of [...(prefix ? [{ kind: "equal" as const, text: prefix }] : []), ...middle, ...(suffix ? [{ kind: "equal" as const, text: suffix }] : [])]) {
    if (!segment.text) continue;
    if (segments.at(-1)?.kind === segment.kind) segments[segments.length - 1]!.text += segment.text;
    else segments.push({ ...segment });
  }
  return segments;
}

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

function diffChangedText(before: string, after: string): DiffSegment[] {
  if (!before || !after) return coarseDiff(before, after);

  // Unlike the public lexical tokenizer, diff units must retain whitespace so
  // the segments reconstruct both original strings exactly.
  const a = before.match(/[A-Za-z0-9]+|\s+|[^\s]/gu) ?? [];
  const b = after.match(/[A-Za-z0-9]+|\s+|[^\s]/gu) ?? [];
  if (a.length > MAX_UNITS || b.length > MAX_UNITS) return coarseDiff(before, after);

  // LCS 动态规划表：dp[i][j] = a[i..] 与 b[j..] 的公共子序列长度
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i * cols + j] = a[i] === b[j]
        ? dp[(i + 1) * cols + (j + 1)]! + 1
        : Math.max(dp[(i + 1) * cols + j]!, dp[i * cols + (j + 1)]!);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (kind: DiffKind, text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) {
      last.text += text;
      return;
    }
    segments.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]!);
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * cols + j]! >= dp[i * cols + (j + 1)]!) {
      push("delete", a[i]!);
      i += 1;
    } else {
      push("insert", b[j]!);
      j += 1;
    }
  }
  while (i < a.length) {
    push("delete", a[i]!);
    i += 1;
  }
  while (j < b.length) {
    push("insert", b[j]!);
    j += 1;
  }

  return segments;
}

export interface DiffSummary {
  addedChars: number;
  removedChars: number;
  changed: boolean;
}

export function summarizeDiff(segments: DiffSegment[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const segment of segments) {
    if (segment.kind === "insert") added += segment.text.length;
    else if (segment.kind === "delete") removed += segment.text.length;
  }
  return { addedChars: added, removedChars: removed, changed: added > 0 || removed > 0 };
}
