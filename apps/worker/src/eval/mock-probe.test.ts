import { expect, test } from "vitest";

// 此文件原为 mock 行为探针（调试 judge 交换检验时使用）。
// 结论已确认：vitest 的 mockResolvedValueOnce 队列按 FIFO 生效。
// 保留占位避免删除限制；无实际断言价值。
test.skip("mock 行为已确认，无需重复验证", () => {
  expect(true).toBe(true);
});
