// 版本号写入的唯一冲突重试。
//
// 版本号用「MAX(version_no) + 1」推导，而唯一约束是
// (entity_type, entity_id, version_no)。在 READ COMMITTED 隔离级别下，
// 两个并发事务可以读到同一个最大值，第二个提交时会撞唯一约束。
//
// 与章节/分卷的序号不同，版本号冲突的后果更重：它发生在事务内部，
// 会导致整个 finalize / 回滚事务回滚，已生成的内容一并丢失。
// 因此统一在这里做「重算并重试」，调用方只需包一层。

const MAX_ATTEMPTS = 3;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function withVersionRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
      // 极短的随机退避，降低两个事务再次撞在同一序号上的概率
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 15));
    }
  }
  throw lastError;
}
