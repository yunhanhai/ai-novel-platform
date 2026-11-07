export interface ExtractOutput {
  characterChanges: { characterName: string; change: string }[];
  worldFacts: { fact: string }[];
  newHooks: { hook: string }[];
  summary: string;
  chapterSummary: string;
}

export class InvalidExtractionOutputError extends Error {
  constructor() { super("INVALID_MODEL_OUTPUT: 模型未返回完整的记忆 JSON，原有记忆未修改"); }
}

export function parseExtraction(text: string): ExtractOutput | null {
  let raw: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    raw = value as Record<string, unknown>;
  } catch { return null; }
  if (typeof raw.summary !== "string" || !raw.summary.trim() || typeof raw.chapterSummary !== "string" || !raw.chapterSummary.trim()) return null;
  for (const [key, fields] of [["characterChanges", ["characterName", "change"]], ["worldFacts", ["fact"]], ["newHooks", ["hook"]]] as const) {
    const rows = raw[key];
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || fields.some(field => typeof row[field] !== "string" || !row[field].trim()))) return null;
  }
  return raw as unknown as ExtractOutput;
}
