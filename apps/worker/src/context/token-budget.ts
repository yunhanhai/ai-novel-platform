// 薄封装：真正的预算裁剪逻辑在 shared 包，避免两处实现漂移。
export { applyTokenBudget } from "@ai-novel/shared/context-composer/token-budget";
