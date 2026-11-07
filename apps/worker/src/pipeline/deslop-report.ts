export interface DeslopReport {
  issues: Array<{
    category: string;
    severity: "info" | "warning" | "error";
    matched: string;
    suggestion: string;
    position: { start: number; end: number };
  }>;
  overallScore: number;
  summary: string;
}
const CATEGORIES = new Set(["stock_phrase", "weak_adverb", "summary_sentence", "abstract_noun_triple", "repetition", "passive_voice", "telling_not_showing"]);

export function parseDeslopReport(text: string, source: string): DeslopReport | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/i, "$1");
  let value: unknown;
  try { value = JSON.parse(cleaned); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.overallScore !== "number" || !Number.isFinite(raw.overallScore) || raw.overallScore < 0 || raw.overallScore > 100 ||
    typeof raw.summary !== "string" || !raw.summary.trim() || !Array.isArray(raw.issues)) return null;
  const issues: DeslopReport["issues"] = [];
  for (const row of raw.issues) {
    if (!row || typeof row !== "object" || Array.isArray(row) || !CATEGORIES.has(row.category) || !["info", "warning", "error"].includes(row.severity) ||
      typeof row.matched !== "string" || !row.matched.trim() || typeof row.suggestion !== "string" || !row.suggestion.trim() ||
      !row.position || typeof row.position !== "object" || Array.isArray(row.position) || !Number.isInteger(row.position.start) || !Number.isInteger(row.position.end) || row.position.start < 0 || row.position.end < row.position.start) return null;
    let { start, end } = row.position as { start: number; end: number };
    if (end > source.length || source.slice(start, end) !== row.matched) {
      start = source.indexOf(row.matched);
      if (start < 0 || source.indexOf(row.matched, start + 1) >= 0) return null;
      end = start + row.matched.length;
    }
    issues.push({ category: row.category, severity: row.severity, matched: row.matched, suggestion: row.suggestion.trim(), position: { start, end } });
  }
  return { issues, overallScore: raw.overallScore, summary: raw.summary.trim() };
}
