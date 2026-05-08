# MVP 第一层应用/API 闭环设计

> 日期：2026-05-08  
> 范围：项目库 service/API、工作台生成入口、PostgreSQL-backed jobs、worker fake generation 闭环

## 背景

`base_win` 是 Windows 本地可运行副本，当前已验证 `pnpm install`、`pnpm db:validate`、`pnpm db:generate`、`pnpm test`、`pnpm typecheck` 和 `pnpm dev:web`。本轮目标来自 `docs/current-progress.md`：实现 MVP 第一层应用/API，从项目库 service/API 开始，并继续使用 PostgreSQL-backed jobs。

现有代码已经包含项目、章节、素材、style/methodology、generation-jobs API、工作台 UI 和 worker skeleton。因此本轮不是从零实现，而是收敛一条可验证闭环。

## 目标

补齐最小 MVP 链路：

1. 在项目库创建或进入项目。
2. 在工作台创建或选择章节。
3. 点击生成章节，HTTP API 创建 generation job。
4. job 写入 PostgreSQL 队列表，状态为 `QUEUED`。
5. worker claim job，状态进入 `RUNNING`。
6. fake chapter pipeline 生成内容，写回 chapter 和 content version。
7. generation steps 与 job 状态更新为 `SUCCEEDED`。
8. 工作台轮询 job 后刷新章节内容。

## 非目标

- 不接入真实 LLM。
- 不引入 Redis 队列。
- 不要求 Docker。
- 不做 auth/session。
- 不做大规模 UI 重构。
- 不新增独立 API 包。

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
   - 注册 `GENERATE_CHAPTER` handler。
   - 直接通过 `packages/db` 写入数据库，不反向调用 Web API。

## 组件设计

### 项目与章节 API

复用现有：

- `apps/web/src/server/projects.ts`
- `apps/web/src/server/chapters.ts`
- `apps/web/src/server/content-versions.ts`
- `apps/web/src/app/api/projects/route.ts`
- `apps/web/src/app/api/projects/[projectId]/chapters/route.ts`
- `apps/web/src/app/api/chapters/[chapterId]/route.ts`

只做必要修补：输入校验、租户过滤、错误状态码、章节内容刷新所需字段。

### Generation Jobs API

复用现有：

- `apps/web/src/app/api/generation-jobs/route.ts`
- `apps/web/src/app/api/generation-jobs/[id]/route.ts`

创建 job 时继续要求 `chapterId` 或 `projectId`。当传入 `chapterId` 时，API 需要验证章节属于当前 organization，并把 target 设置为 `CHAPTER`。

### Job Repository

复用：

- `createJob`
- `claimNextJob`
- `updateJobStatus`
- `createStep`
- `updateStep`

如需修改，限制在：

- 防止非法状态转换。
- 失败时写入 `errorCode` / `errorMessage`。
- 无 handler 时避免 job 长期停留在 `RUNNING`。

### Worker

当前 `apps/worker/src/index.ts` 已创建 poller，但 handlers 为空。本轮要注册 `GENERATE_CHAPTER` handler。

handler 负责：

1. 读取 job input、projectId、target chapterId。
2. 创建 generation step。
3. 调用 fake chapter generation pipeline。
4. 更新 chapter 内容与 word count。
5. 保存 content version。
6. 更新 step 为 `SUCCEEDED`。
7. 更新 job 为 `SUCCEEDED`。

失败时：

- 更新 step 为 `FAILED`（如果 step 已创建）。
- 更新 job 为 `FAILED`。
- 写入可读错误信息。

## 数据流

```text
Workspace UI
  -> POST /api/generation-jobs
  -> packages/db createJob
  -> generation_jobs QUEUED
  -> worker claimNextJob
  -> generation_jobs RUNNING
  -> GENERATE_CHAPTER handler
  -> fake pipeline
  -> update chapter + content_versions + generation_steps
  -> generation_jobs SUCCEEDED
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
- 无 handler 不允许让 job 永久卡在 `RUNNING`。
- 不静默吞掉错误。

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
8. 编辑区刷新后出现 fake 生成内容。

## 风险与约束

- 当前目录刚初始化为本地 Git 仓库，后续提交需显式确认。
- 如使用临时分支，必须在使用完后及时合并，并在进展记录中写明分支目的与合并结果。
- `DEFAULT_ORGANIZATION_ID` / `DEFAULT_USER_ID` 仍是本地 MVP 上下文替代方案，不代表正式 auth 设计。
- PostgreSQL 是唯一必需队列依赖，Redis 仍不参与 MVP 闭环。

## 完成后记录

实现完成后更新：

- `docs/current-progress.md`
- `docs/plans/2026-05-08-base-win-localization-plan.md`
