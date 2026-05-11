# MVP 第一层应用/API 闭环设计

> 日期：2026-05-08  
> 范围：项目库 service/API、工作台生成入口、PostgreSQL-backed jobs、worker fake generation 闭环

## 背景

`base_win` 是 Windows 本地可运行副本，当前已验证 `pnpm install`、`pnpm db:validate`、`pnpm db:generate`、`pnpm test`、`pnpm typecheck` 和 `pnpm dev:web`。本轮目标来自 `docs/current-progress.md`：实现 MVP 第一层应用/API，从项目库 service/API 开始，并继续使用 PostgreSQL-backed jobs。

现有代码已经包含项目、章节、素材、style/methodology、generation-jobs API、工作台 UI、worker poller 和 fake chapter pipeline。当前缺口不是生成逻辑本身，而是：worker 尚未注册业务 handler；poller 的 no-handler 分支不会失败落库；pipeline 与真实 DB 写回链路尚未在 worker 入口接通；手动验收尚未覆盖 job、chapter、content version、steps 的一致性。

## 目标

补齐最小 MVP 链路：

1. 在项目库创建或进入项目。
2. 在工作台创建或选择章节。
3. 点击生成章节，HTTP API 创建 generation job。
4. job 写入 PostgreSQL 队列表，状态为 `QUEUED`。
5. worker claim job，状态进入 `RUNNING`。
6. worker 的 `GENERATE_CHAPTER` handler 调用现有 fake pipeline。
7. handler 把 pipeline 结果写回 chapter、content version、generation steps。
8. job 状态更新为 `SUCCEEDED`，output 返回可定位结果。
9. 工作台轮询 job 后刷新章节内容。

## 非目标

- 不接入真实 LLM。
- 不引入 Redis 队列。
- 不要求 Docker。
- 不做 auth/session。
- 不做大规模 UI 重构。
- 不新增独立 API 包。
- 不在本轮强制改造 `packages/db/src/generation-jobs.ts` 的完整状态机校验；如实现中触及该文件，只做 MVP 闭环必需修补。

## 架构边界

保留现有四层结构：

1. 应用服务层：`apps/web/src/server/`
   - 处理项目、章节、内容版本等业务写入。
   - 保持租户过滤和 service 函数边界。

2. HTTP API 层：`apps/web/src/app/api/`
   - 解析请求、做边界校验、返回统一响应。
   - 不承载长流程生成逻辑。

3. PostgreSQL job repository：`packages/db/src/generation-jobs.ts`
   - 负责 create、claim、status、step。
   - 继续使用 PostgreSQL-backed jobs。

4. worker pipeline：`apps/worker/src/`
   - 消费 PostgreSQL jobs。
   - 在 `apps/worker/src/index.ts` 注册 `GENERATE_CHAPTER` handler。
   - 优先复用 `apps/worker/src/pipeline/chapter-pipeline.ts`；若其返回值不能表达真实持久化结果，则在 handler 适配层用真实 DB 写回结果覆盖 job output。
   - 直接通过 `packages/db` 写入数据库，不反向调用 Web API。

## 必改文件

### `apps/worker/src/poll.ts`

当前 no-handler 分支只返回 `no_handler`。本轮应把已 claim 的 job 标记为 `FAILED`，`errorCode` 为 `NO_HANDLER`，`errorMessage` 说明未注册 handler，避免 job 长期停留在 `RUNNING`。

同时必须扩展两处现有实现：

1. 文件内的 `GenerationJob` interface 当前仅有 `id/organizationId/projectId/userId/jobType/status/input`，需补上 `targetEntityType?: "PROJECT" | "OUTLINE" | "CHAPTER" | null` 和 `targetEntityId?: string | null`，否则 handler 拿不到 spec 要求的优先字段。
2. 现有 catch 分支调用 `updateJobStatus` 时使用 `{} as PrismaClient` 占位，仅靠测试 mock 通过。本轮 no-handler/handler-error 分支落库要走真实 DB，`prisma` 必须由 `apps/worker/src/index.ts` 注入的 `updateStatusFn` wrapper 提供，poll.ts 内不得再传占位字段。

### `apps/worker/src/poll.test.ts`

把“ignores jobs with no registered handler”调整为“marks no-handler jobs failed”。断言：

- `tick()` 返回 `no_handler`。
- `updateJobStatus` 被调用。
- 参数包含 `jobId`、`status: "FAILED"`、`errorCode: "NO_HANDLER"`。

### `apps/worker/src/index.ts`

注册 `GENERATE_CHAPTER` handler。handler 需要用真实 `prisma` 和 `@ai-novel/db` 的 job/step helpers 接入 pipeline。

### Worker handler 适配层

新增文件位置：`apps/worker/src/pipeline/generate-chapter-handler.ts`，由 `index.ts` 注册到 `handlers` Map。不要把适配层逻辑散落在 `index.ts` 内联。

必须存在 handler 适配层，并满足以下约束：

1. 从 job target 或 input 解析 `chapterId`，优先使用 `targetEntityType === "CHAPTER"` 时的 `targetEntityId`。
2. 查询 chapter，确认属于 `job.organizationId` 和 `job.projectId`。
3. 调用 fake pipeline，得到最终正文与步骤元数据。
4. 在提交阶段写回 chapter content、wordCount、lastGeneratedJobId。
5. 创建 content version，source 为 `AI`，generationJobId 为当前 job。
6. 写入 generation steps。
7. 调用 `updateJobStatus`，状态为 `SUCCEEDED`，output 至少包含 `chapterId`、`versionId`、`versionNo`、`wordCount`。

若复用 `runChapterPipeline`，不得依赖其当前固定的 `versionId: "v-final"` 作为验收结果；真实 job output 必须来自实际持久化返回值或 handler 适配层计算结果。

### 测试文件

新增或修改现有 worker 测试，覆盖：

- `GENERATE_CHAPTER` handler 成功时写回 chapter/content version/job output。
- handler 找不到 chapter 时 job 失败。
- no-handler job 失败落库。

## 复用文件

### 项目与章节 API

复用现有：

- `apps/web/src/server/projects.ts`
- `apps/web/src/server/chapters.ts`
- `apps/web/src/server/content-versions.ts`
- `apps/web/src/app/api/projects/route.ts`
- `apps/web/src/app/api/projects/[projectId]/chapters/route.ts`
- `apps/web/src/app/api/chapters/[chapterId]/route.ts`

只在发现闭环必需缺陷时修补。

### Generation Jobs API

复用现有：

- `apps/web/src/app/api/generation-jobs/route.ts`
- `apps/web/src/app/api/generation-jobs/[id]/route.ts`

创建 job 时继续要求 `chapterId` 或 `projectId`。当传入 `chapterId` 时，API 已验证章节属于当前 organization，并把 target 设置为 `CHAPTER`。

### Job Repository

复用：

- `createJob`
- `claimNextJob`
- `updateJobStatus`
- `createStep`
- `updateStep`

本轮不把完整状态机校验作为交付前提；该项可在后续队列健壮性任务中处理。

## 数据来源

### 组织与用户

- `organizationId` 来自 `getOrganizationId()`，当前 MVP 读取 `DEFAULT_ORGANIZATION_ID`。
- `userId` 来自 `getUserId()`，当前 MVP 读取 `DEFAULT_USER_ID`。
- 这两个值只在 API 创建 job 和 worker 写 content version 时作为本地 MVP 上下文使用；正式 auth 不在本轮范围内。

### 项目与章节

- `projectId` 的权威来源是 chapter 查询结果或请求体中的 `projectId`。
- 当 API 收到 `chapterId` 时，必须通过 `prisma.chapter.findFirst({ where: { id: chapterId, organizationId, deletedAt: null } })` 解析真实 `projectId`。
- `chapterId` 的权威来源优先级：`job.targetEntityType === "CHAPTER" && job.targetEntityId` > `job.input.chapterId`。
- worker 必须重新读取 chapter，并确认 `chapter.organizationId === job.organizationId` 且 `chapter.projectId === job.projectId`，不能只信任 job input。

### 生成输入

- `job.input` 保存前端提交的附加生成参数。
- MVP 成功闭环只依赖 `chapterId` 和现有上下文构建逻辑；其他 prompt 参数可以透传，但不能作为 project/chapter 归属的权威来源。
- fake model 输出是正文来源；最终落库正文必须来自 pipeline 的最终正文，而不是固定占位 version id。

### 输出字段

成功 job 的 `output` 是跨表一致性的摘要，必须由实际持久化结果组装：

```ts
{
  chapterId: string,
  versionId: string,
  versionNo: number,
  wordCount: number
}
```

`versionId` 和 `versionNo` 必须来自 `contentVersion.create` 返回值；`wordCount` 必须与更新后的 chapter.wordCount 一致。

### wordCount 计算

`runChapterPipeline` 当前不返回 wordCount，handler 必须自己根据最终正文计算。本轮 MVP 使用确定算法：

```ts
const wordCount = [...content.replace(/\s+/g, "")].length;
```

理由：以 Unicode code point 统计去除空白后的字符数，对中英混排稳定，能在 fake pipeline 输出下保证 `wordCount > 0`。后续接入真实 LLM 或多语言时可再演进，但本轮约定此算法是 chapter.wordCount 与 output.wordCount 的唯一来源。

### versionNo 计算

`content_versions` 上有唯一约束 `(entity_type, entity_id, version_no)`。本轮约定在最终提交事务内通过下一序号策略计算：

```ts
const last = await tx.contentVersion.findFirst({
  where: { entityType: "CHAPTER", entityId: chapterId },
  orderBy: { versionNo: "desc" },
  select: { versionNo: true }
});
const nextVersionNo = (last?.versionNo ?? 0) + 1;
```

必须在 `contentVersion.create` 之前的同一事务内执行；不允许在事务外预读 versionNo。MVP 不针对并发同章节生成做额外锁，若发生唯一冲突，按多表事务失败路径处理（job 落 `FAILED`、`errorCode: "FINALIZE_FAILED"`）。

## 多表一致性

生成成功的最终提交必须在一个 Prisma `$transaction` 中完成。事务内按固定顺序执行：

1. 重新读取并校验 chapter：`id`、`organizationId`、`projectId`、`deletedAt`。
2. 计算 `nextVersionNo`（参见 §versionNo 计算）。
3. 更新 chapter：`content`、`wordCount`（参见 §wordCount 计算）、`updatedById = job.userId`、`lastGeneratedJobId = job.id`。
4. 创建 content version，所有 NOT NULL 字段都必须显式赋值：
   - `organizationId = job.organizationId`
   - `projectId = chapter.projectId`
   - `entityType = "CHAPTER"`
   - `entityId = chapterId`
   - `versionNo = nextVersionNo`
   - `content = finalContent`
   - `source = "AI"`
   - `generationJobId = job.id`
   - `createdById = job.userId`
5. 写入一条 `generation_steps` 记录作为提交标记，`stepKey = "finalize"`、`status = "SUCCEEDED"`、`jobId = job.id`、`organizationId = job.organizationId`。
6. 更新 generation job：`status: "SUCCEEDED"`、`progress: "100"`、`finishedAt = now`、`output` 使用事务内实际返回值。

### Pipeline 复用边界

`runChapterPipeline` 当前结构与"最终单一事务"不直接兼容：它内部在 `persist_version` 步通过 `persistVersion` 回调写库、并通过 `createStep`/`updateStep` 提交多步 step。本轮选择以下复用方式：

- 复用 `runChapterPipeline` 的 plan / draft / review / revise / extract_memory 五个 step 及其 `createStep` + `updateStep` 调用。这些 step 在最终事务**之外**完成，事务回滚不会清除它们；这是允许的，因为它们承载过程可观测性而非提交语义。
- handler 注入的 `persistVersion` 回调**不再写库**，只回传最终正文与 wordCount，例如：
  ```ts
  persistVersion: async ({ content }) => {
    finalContent = content;
    return { id: "pending", versionNo: 0 };
  }
  ```
  pipeline 内 `persist_version` step 的 outputPreview 仍可写"pending"，作为流程可观测记录；`runChapterPipeline` 返回的 `versionId: "v-final"` / `versionNo: 1` 一律忽略。
- 真正的 `chapter.update` + `contentVersion.create` + `finalize` step + `generationJob` 成功状态，全部由 handler 适配层在 §多表一致性 的 `$transaction` 内执行。
- handler 不得再调用 pipeline 之外的额外 `persistVersion`、不得在事务外创建任何 `content_versions` 记录。

### 事务客户端规则

- 最终提交阶段必须使用同一个 Prisma transaction client。
- 现有 `createStep` / `updateStep` / `updateJobStatus` helper 的入参类型为 `prisma: PrismaClient`，不接受 transaction client。本轮选项：
  1. 扩展 helper 入参类型为 `prisma: PrismaClient | Tx`（其中 `Tx` 即 `generation-jobs.ts` 已有的内部类型）；或
  2. 在 handler 适配层内直接使用 `tx.chapter.update` / `tx.contentVersion.create` / `tx.generationStep.create` / `tx.generationJob.update` 完成最终提交。
- MVP 优先选项 2，避免修改 `packages/db` 公共签名；如选项 1，需同步更新 `generation-jobs.test.ts`。
- 不允许在最终成功路径里先提交 chapter/content version，再在事务外单独标记 job `SUCCEEDED`。

### 失败处理

- 如果 pipeline 在最终提交前失败，更新 job 为 `FAILED`，不写入 chapter/content version/finalize step；pipeline 中已落库的中间 step（plan/draft/...）保持原状，不补写额外的 FAILED step。
- 如果最终提交事务失败，事务内的 chapter/content version/finalize step/job 成功状态全部回滚；随后在事务外尝试把 job 标为 `FAILED` 并写入错误信息。
- 事务失败路径不补写 `finalize FAILED`，因为该 step 属于成功提交事务；失败可观测性以 job `FAILED`、`errorCode`、`errorMessage` 为准。
- no-handler 不进入生成事务，直接把 job 标为 `FAILED` / `NO_HANDLER`。

一致性验收以 `generation_jobs.id` 为主键串联：

```text
generation_jobs.id
  = content_versions.generation_job_id
  = generation_steps.job_id

generation_jobs.output.chapterId
  = chapters.id
  = content_versions.entity_id

generation_jobs.output.versionNo
  = content_versions.version_no

generation_jobs.output.wordCount
  = chapters.word_count
```


## 数据流

```text
Workspace UI
  -> POST /api/generation-jobs
  -> API resolves organizationId/userId/projectId/chapterId
  -> packages/db createJob with targetEntityId/input
  -> generation_jobs QUEUED
  -> worker claimNextJob
  -> generation_jobs RUNNING
  -> registered GENERATE_CHAPTER handler reloads chapter
  -> existing fake chapter pipeline produces final content
  -> transaction persists chapter + content_versions + generation_steps + job output
  -> generation_jobs SUCCEEDED with real output
  -> Workspace polling GET /api/generation-jobs/[id]
  -> refresh chapter content
```

## 错误处理

API 边界返回统一结构：

```ts
{ success: true, data }
{ success: false, error }
```

状态码约定：

- `400`：输入缺失或非法。
- `404`：项目、章节或 job 不存在。
- `409`：唯一冲突。
- `500`：非预期服务异常。

worker 约定：

- handler 抛错时 job 必须落库为 `FAILED`。
- 无 handler 时 job 必须落库为 `FAILED`，`errorCode` 为 `NO_HANDLER`。
- 找不到 chapter 时 job 必须落库为 `FAILED`，`errorCode` 为 `CHAPTER_NOT_FOUND` 或同等语义。
- 不静默吞掉错误。
- 不释放到无限重试，除非后续单独设计重试策略。

worker `errorCode` 取值表（本轮统一使用，便于断言与日志检索）：

| errorCode | 触发场景 | 写入位置 |
|-----------|----------|----------|
| `NO_HANDLER` | claim 到 job 但 `handlers` Map 无对应 jobType | poll.ts no-handler 分支 |
| `CHAPTER_NOT_FOUND` | handler 内重新读 chapter 失败，或 organizationId/projectId 不匹配 | handler 适配层（事务前） |
| `FINALIZE_FAILED` | 最终提交事务抛错（含唯一约束冲突） | handler 适配层（事务外回写） |
| `HANDLER_ERROR` | 其他未分类 handler 异常，由 poll.ts catch 兜底 | poll.ts 异常分支 |

## 成功判定

一次 fake 章节生成成功必须同时满足：

- job status 为 `SUCCEEDED`。
- job output 包含真实 `chapterId`、`versionId`、`versionNo`、`wordCount`。
- chapter content 非空，且 `wordCount > 0`。
- 至少存在一个 `content_versions` 记录，source 为 `AI`，generationJobId 指向该 job。
- 至少存在一条 `generation_steps` 记录，且该记录的 `jobId` 指向当前 job、`stepKey` 为 `finalize`、`status` 为 `SUCCEEDED`。
- 工作台刷新后显示的章节内容与数据库 chapter content 一致。

## 验收标准

自动验证：

```bash
pnpm db:validate
pnpm test
pnpm typecheck
```

如 schema/client 有变化，再运行：

```bash
pnpm db:generate
```

手动验证：

1. 启动 Web：`pnpm dev:web`。
2. 启动 worker：`pnpm --filter @ai-novel/worker dev`。
3. 打开项目库。
4. 新建或进入项目。
5. 新建或选择章节。
6. 点击生成章节。
7. 任务状态从 `QUEUED` / `RUNNING` 到 `SUCCEEDED`。
8. 编辑区刷新后出现非空章节内容。
9. 通过 job detail API 确认 output 和 steps 可见。
10. 用固定字段确认落库一致性：
    - job detail API：`data.id` 等于本次 job id，`data.output.chapterId` 等于章节 id，`data.output.versionId` 非空，`data.output.versionNo` 等于版本号，`data.output.wordCount > 0`。
    - chapter API 或数据库：chapter `id` 等于 output chapterId，`content` 非空，`wordCount` 等于 output wordCount，`lastGeneratedJobId` 等于 job id。
    - content version：`entityType` 为 `CHAPTER`，`entityId` 等于 chapter id，`generationJobId` 等于 job id，`versionNo` 等于 output versionNo，`id` 等于 output versionId。
    - generation steps：至少一条 step 的 `jobId` 等于 job id，`organizationId` 等于 job organizationId，`stepKey` 为 `finalize`，`status` 为 `SUCCEEDED`。
    - 事务性单元测试：在 worker handler 适配层测试中注入一个 fake transaction client，使执行顺序到 `contentVersion.create` 后抛出 `Error("commit failed")`。运行命令为 `pnpm --filter @ai-novel/worker test`。断言：chapter update 未提交；content version 未提交；`finalize` step 未提交；job 未被标为 `SUCCEEDED`；事务外失败回写被调用，参数包含 `status: "FAILED"`、`errorCode: "FINALIZE_FAILED"` 或同等语义、`errorMessage` 包含原始错误。
    - 真实数据库补充验收（如执行）：使用测试 schema 构造同一 chapter/versionNo 唯一约束冲突或 mock tx 抛错，测试后清理该 schema；断言字段与单元测试一致。

no-handler 验收：

- poller 单元测试构造一个无注册 handler 的 claimed job。
- `tick()` 返回 `no_handler`。
- 对应 job 不停留在 `RUNNING`，而是落库为 `FAILED`，`errorCode` 为 `NO_HANDLER`。

## 风险与约束

- `DEFAULT_ORGANIZATION_ID` / `DEFAULT_USER_ID` 仍是本地 MVP 上下文替代方案，不代表正式 auth 设计。
- PostgreSQL 是唯一必需队列依赖，Redis 仍不参与 MVP 闭环。
- 当前 fake pipeline 已存在多步实现，实施时应优先接线和验证，不重复建设生成逻辑。
- `runChapterPipeline` 当前返回固定 final version 占位值，handler 必须以实际持久化结果作为 job output。
- no-handler 卡单是当前 worker poller 的主要队列风险，本轮必须处理。
- 多表成功写入必须通过事务保证；若现有 helper 不能接收 transaction client，最终提交阶段必须直接使用 transaction client 或扩展 helper。

## 完成后记录

实现完成后更新：

- `docs/current-progress.md`
- `docs/plans/2026-05-08-base-win-localization-plan.md`
