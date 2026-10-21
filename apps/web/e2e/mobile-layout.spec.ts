import { test } from "@playwright/test";

// 移动端布局断言已并入 smoke.spec.ts 末尾（复用同一登录态与页面，
// 避免多 spec 并行时共享 dev server / 数据库造成的时序冲突）。
// 保留该文件是为了记录布局覆盖点，实际用例在 smoke 中执行。
test.skip("移动端布局断言见 smoke.spec.ts（避免多 spec 并行冲突）", async () => {});
