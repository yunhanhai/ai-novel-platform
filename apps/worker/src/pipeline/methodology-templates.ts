// 方法论模板工具：模板数据从 shared 包加载，本文件提供 outline 骨架生成与指南渲染

import {
  getMethodologyTemplate as getTemplate,
  listMethodologyTemplates as listTemplates,
  type MethodType,
  type OutlineSkeletonNode,
  type MethodologyTemplate
} from "@ai-novel/shared/methodology/templates";

export type { MethodType, OutlineSkeletonNode, MethodologyTemplate };

export const getMethodologyTemplate = getTemplate;
export const listMethodologyTemplates = listTemplates;

export interface MethodologyLike {
  name?: string;
  methodType?: MethodType | string;
  description?: string | null;
  outlineMetadata?: unknown;
  reviewCriteria?: unknown;
}

// 根据方法论类型生成 outline 骨架（不入库，由调用方决定如何持久化）
export function generateOutlineSkeleton(methodType: MethodType): OutlineSkeletonNode[] {
  try {
    const tmpl = getTemplate(methodType);
    return tmpl.outlineMetadata.nodes.map((n) => ({ ...n }));
  } catch {
    return [];
  }
}

// 把方法论渲染成 prompt 片段，长度控制在 200-400 字
export function renderMethodologyGuide(methodology: MethodologyLike): string {
  const lines: string[] = [];
  if (methodology.name) {
    lines.push(`【方法论】${methodology.name}`);
  }
  if (methodology.methodType) {
    lines.push(`类型：${methodology.methodType}`);
  }
  if (methodology.description) {
    lines.push(methodology.description);
  }

  const outlineNotes = extractOutlineNotes(methodology.outlineMetadata);
  if (outlineNotes.length > 0) {
    lines.push("结构提示：");
    for (const n of outlineNotes.slice(0, 5)) {
      lines.push(`- ${n}`);
    }
  }

  const review = extractReviewCriteria(methodology.reviewCriteria);
  if (review.length > 0) {
    lines.push("审查重点：");
    for (const r of review.slice(0, 5)) {
      lines.push(`- ${r}`);
    }
  }

  const text = lines.join("\n");
  if (text.length <= 400) return text;
  return `${text.slice(0, 397)}...`;
}

function extractOutlineNotes(meta: unknown): string[] {
  if (!isPlainObject(meta)) return [];
  const notes = meta.notes;
  if (Array.isArray(notes)) return notes.filter((x): x is string => typeof x === "string");
  const nodes = meta.nodes;
  if (Array.isArray(nodes)) {
    return nodes
      .filter(isPlainObject)
      .map((n) => (typeof n.title === "string" ? n.title : ""))
      .filter((t) => t.length > 0);
  }
  return [];
}

function extractReviewCriteria(criteria: unknown): string[] {
  if (!isPlainObject(criteria)) return [];
  const merged: string[] = [];
  for (const key of ["structureChecks", "pacingChecks", "forbiddenMoves"] as const) {
    const list = criteria[key];
    if (Array.isArray(list)) {
      merged.push(...list.filter((x): x is string => typeof x === "string"));
    }
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
