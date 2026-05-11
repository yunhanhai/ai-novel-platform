// 章节字数统计 — chapter.wordCount 的唯一算法。
// 中英混排稳定：去除空白后按 Unicode code point 统计，避免半角空格被计入或被代理对截断。
// 来源决策：apps/worker handler 与 apps/web chapter PATCH 必须共享此实现，否则
// AI 生成与人工编辑会写入不一致的 wordCount。
export function computeWordCount(content: string): number {
  return [...content.replace(/\s+/g, "")].length;
}
