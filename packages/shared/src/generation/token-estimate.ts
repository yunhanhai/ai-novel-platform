// 面向中文内容的 token 估算。
// 多数主流分词器对中文约 0.6~1.5 字/token，按 1 字 ≈ 1 token 估算是安全上界；
// 非 CJK 文本沿用英文经验值 4 字符 ≈ 1 token。
// 中文标点（，。！？：；"" 等 U+3000 与 U+FF00 区段）同样按 1 token 计——
// 小说文本几乎句句带标点，漏掉会系统性低估。
// 用于上下文预算裁剪与生成前的成本准入判断，不要求精确、但方向不能失真。

const CJK_PATTERN =
  /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_PATTERN) ?? []).length;
  const nonCjkCount = text.length - cjkCount;
  return cjkCount + Math.ceil(nonCjkCount / 4);
}
