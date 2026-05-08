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

### `apps/worker/src/poll.test.ts`

把“ignores jobs with no registered handler”调整为“marks no-handler jobs failed”。断言：

- `tick()` 返回 `no_handler`。
- `updateJobStatus` 被调用。
- 参数包含 `jobId`、`status: "FAILED"`、`errorCode: "NO_HANDLER"`。

### `apps/worker/src/index.ts`

注册 `GENERATE_CHAPTER` handler。handler 需要用真实 `prisma` 和 `@ai-novel/db` 的 job/step helpers 接入 pipeline。

### Worker handler 适配层

必须存在 handler 适配层，并满足以下约束：

1. 从 job target 或 input 解析 `chapterId`。
2. 查询 chapter，确认属于 `job.organizationId`。
3. 调用 fake pipeline。
4. 写回 chapter content 与 wordCount。
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

## 数据流

```text
Workspace UI
  -> POST /api/generation-jobs
  -> packages/db createJob
  -> generation_jobs QUEUED
  -> worker claimNextJob
  -> generation_jobs RUNNING
  -> registered GENERATE_CHAPTER handler
  -> existing fake chapter pipeline
  -> handler persists chapter + content_versions + generation_steps
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

## 成功判定

一次 fake 章节生成成功必须同时满足：

- job status 为 `SUCCEEDED`。
- job output 包含真实 `chapterId`、`versionId`、`versionNo`、`wordCount`。
- chapter content 非空，且 `wordCount > 0`。
- 至少存在一个 `content_versions` 记录，source 为 `AI`，generationJobId 指向该 job。
- 至少存在一条 `generation_steps` 记录，且该记录的 `jobId` 指向当前 job、`status` 为 `SUCCEEDED` 或等价成功状态。
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
    - chapter API 或数据库：chapter `id` 等于 output chapterId，`content` 非空，`wordCount` 等于 output wordCount。
    - content version：`entityId` 等于 chapter id，`generationJobId` 等于 job id，`versionNo` 等于 output versionNo。
    - generation steps：至少一条 step 的 `jobId` 等于 job id，`status` 为成功状态。

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

## 完成后记录

实现完成后更新：

- `docs/current-progress.md`
- `docs/plans/2026-05-08-base-win-localization-plan.md`
