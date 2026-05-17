# Current Progress

> Last updated: 2026-05-17

## Completed

- Created this Windows-local runnable copy at `D:\develop\AI\xiaoshuo\base_win` from source project `D:\develop\AI\xiaoshuo\base`.
- Copied project source, configuration, infrastructure, scripts, and documentation.
- Excluded generated or local-only folders and files:
  - `.git/`
  - `node_modules/`
  - `.pnpm-store/`
  - `.worktrees/`
  - `.next/`
  - `dist/`
  - `build/`
  - `*.tsbuildinfo`
- Created project-local Claude instructions:
  - `CLAUDE.md`
- Created base_win localization plan:
  - `docs/plans/2026-05-08-base-win-localization-plan.md`
- Created local runtime environment file:
  - `.env`
- Created a local Git repository for `base_win`.
- Updated expansion roadmap external references with Author series research:
  - `YuanShiJiLoong/author` as AI writing workbench interaction reference.
  - `mleafish/author` as local-first/privacy-first adaptation reference.
  - Recorded AGPL-3.0 boundary: product mechanism reference only, no code/schema/prompt/text reuse.
- Recorded branch workflow rule:
  - If temporary branches are used, merge them back promptly after use and record the branch purpose and merge result in the session progress notes.
- Confirmed Windows-first local development:
  - PostgreSQL is required.
  - Docker is optional and currently not installed in PATH.
  - Redis is optional for the current PostgreSQL queue path; a local Redis Windows service is running on `127.0.0.1:6379` without a password.
  - MVP queue driver is `postgres`.
- Reused the existing local database:
  - database: `ai_novel_platform`
- Designed and implemented MVP application/API loop (chapter generation closed loop):
  - Spec: `docs/superpowers/specs/2026-05-08-mvp-application-api-loop-design.md`
    - Reviewed against source;補上 §数据来源、§多表一致性、§Pipeline 复用边界、§wordCount 计算、§versionNo 计算、§errorCode 表。
  - Worker poller (`apps/worker/src/poll.ts`): no-handler 分支落库为 `FAILED` / `NO_HANDLER`；`GenerationJob` interface 扩展 `targetEntityType` / `targetEntityId`；移除占位 prisma，由 `index.ts` wrapper 注入真实 prisma。
  - Handler 适配层 (`apps/worker/src/pipeline/generate-chapter-handler.ts`): 解析 `chapterId`（target 优先 → input 回落）→ 预查 chapter 校验 `organizationId/projectId` → 复用 `runChapterPipeline`（`persistVersion` 退化为只回传内容的 passthrough）→ 在单一 `prisma.$transaction` 内 `MAX(versionNo)+1` → 更新 chapter（content/wordCount/updatedById/lastGeneratedJobId）→ 创建 content version（含全部 NOT NULL 字段）→ 写 `finalize` step → 标记 job `SUCCEEDED`。错误码：`CHAPTER_NOT_FOUND` / `HANDLER_ERROR` / `FINALIZE_FAILED`。
  - 注册 handler 到 `apps/worker/src/index.ts`，handler Map 改用 `new Map<string, JobHandler>([...])` 构造。
  - 抽 `computeWordCount` 到 `packages/shared/src/generation/word-count.ts`（去空白后按 Unicode code point 统计），消除 chapter PATCH 与 handler 之间 wordCount 算法不一致；新增 `apps/web/.../route.ts` 引用同一函数。
  - 清理：删除 `runChapterPipeline` 返回的占位 `versionId: "v-final"` / `versionNo: 1`；删除生产无引用的 `apps/worker/src/pipeline/generate-chapter.ts` + 同名 `.test.ts`。
  - 环境配置：`.env` 增补 `DEFAULT_ORGANIZATION_ID` / `DEFAULT_USER_ID`；新建 `apps/web/.env.local`（Next.js 只在 app 目录加载，不读 monorepo 根）；`apps/worker/package.json` `dev` 改为 `tsx --env-file=../../.env src/index.ts` 让 worker 启动时读根 .env。

## Verification Evidence

These tools are installed and usable on this Windows machine:

```text
Node.js: v22.15.0
pnpm: 10.10.0
npm: 10.9.2
Git: 2.45.1.windows.1
Windows PowerShell: 5.1.26100.8115
PostgreSQL: 16.13
```

These optional tools are not currently available in PATH:

```text
Docker
Redis CLI commands (`redis-server`, `redis-cli`)
PowerShell 7 (`pwsh`)
```

Redis is installed as a Windows service and currently running:

```text
Service: Redis
Status: Running
StartType: Automatic
Version: 5.0.9
Address: 127.0.0.1:6379
Auth: no password (`CONFIG GET requirepass` returned empty)
PING: PONG
```

PostgreSQL binary paths exist:

```text
D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe
D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe
D:\myTool\develop\PostgreSQL\data
D:\myTool\develop\PostgreSQL\postgresql.log
```

Current database connection works:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
```

The current `ai_novel_platform` database contains 27 public tables.

Applied Prisma migrations:

```text
202604290001_initial_core
20260501001_add_writing_assets
20260501002_add_deslop_style_method
```

Prisma schema validation passed in this workspace:

```bash
pnpm db:validate
```

Current session verification in `base_win` passed:

```text
2026-05-08 roadmap update: reviewed inserted lines in docs/plans/2026-05-01-expansion-roadmap.md; no git commit performed.
pnpm install: passed
pnpm db:validate: passed
pnpm db:generate: passed
pnpm test: 37 test files passed, 225 tests passed
pnpm typecheck: passed
pnpm db:validate && pnpm typecheck: passed again after Redis check
pnpm dev:web: HTTP 200, page contains AI Novel Platform
```

2026-05-11 MVP API loop verification:

```text
pnpm db:validate: passed
pnpm typecheck: 4 packages passed
pnpm test: shared 22 + db 12 + worker 86 + web 110 = 230 tests passed
Manual closure (web + worker live):
  POST /api/generation-jobs (chapter 00000000-...0004, GENERATE_CHAPTER) -> QUEUED
  Worker claimed -> RUNNING -> SUCCEEDED in ~70ms
  Job output: { chapterId, versionId, versionNo: 3, wordCount: 125 }
  Cross-table consistency (PG psql):
    chapters.word_count = 125, content non-empty, last_generated_job_id = job.id
    content_versions: id = output.versionId, version_no = 3, source = AI, generation_job_id = job.id, created_by = DEFAULT_USER_ID
    generation_steps.finalize: status = succeeded, organization_id correct
    generation_jobs.output = { chapterId, versionId, versionNo, wordCount } 全字段一致
  Second run on same chapter: versionNo 3 -> 4 (pickNextVersionNo monotonic)
```

2026-05-12..16 期间合入的上游变更（来自 source repo，已 commit 进 base_win）：

- `feat(worker): add real LLM adapter — OpenAI, Anthropic, model routing (TDD)` (1959df6)
- `test(web): add API route tests for all 19 API endpoints` (e7ffd82)
- `feat(web): add outline editor panel and deslop apply-suggestion button` (7fcd1e3)
- `feat(worker): wire active methodology into pipeline plan/review steps` (2d1cfb9)
- `feat(worker+web): add DESLOP and EXTRACT_MEMORY standalone job handlers` (af709c9)
- `feat(web): add session-based auth — login, register, logout` (64ef4b9)
- `fix(db+worker): set startedAt on all generation step creates` (94eca34)

2026-05-17 本会话工作：

- 健康检查发现 64ef4b9 引入的 session middleware 在 Edge Runtime 下崩溃：`apps/web/src/middleware.ts` 经由 `verifySession` 引入 `node:crypto`，所有 matcher 路径返回 HTTP 500。
- 修复方案 A（统一 Web Crypto）：
  - 重写 `apps/web/src/server/auth.ts`：用 `crypto.subtle.importKey/sign/verify` 实现 HS256；`signSession` / `verifySession` 改为 async；token 格式（`header.body.sig`、base64url、HS256）完全不变，已签发的 cookie 仍可验过。
  - byte helper 统一返回 `Uint8Array<ArrayBuffer>` 以满足 TS 5.7+ 严格 `BufferSource` 类型。
  - `apps/web/src/middleware.ts` 改为 `async function middleware` 并 `await verifySession(token)`。
  - `apps/web/src/server/auth.test.ts` 4 处 `await`；去掉原 "rejects expired token" 用例里逻辑自相矛盾的注释/构造，改为纯 sanity check（freshly-signed token 必须验过）。
  - `apps/web/.env.local` 补 `SESSION_SECRET`（本地开发值，.gitignore 已排除）。
- worker 同步改动（基于"既然修就一起完整化"的判断）：
  - `apps/worker/src/pipeline/deslop-handler.ts` / `extract-memory-handler.ts`：接入 `resolveModel(job) → ModelProfile`，对齐 `generate-chapter-handler` 的模型解析路径；保留旧的 `model` 注入作为测试 hook（兜底）；新增错误码 `NO_MODEL_PROFILE`；用本地 `fail()` helper 统一 FAILED 落库。
  - `apps/worker/src/index.ts`：注册 handler 时把 `resolveModel` 也传给 DESLOP / EXTRACT_MEMORY。

验证证据：

```text
pnpm typecheck: 4 packages passed
pnpm test: shared 22 + db 12 + worker 131 + web 166 = 331 tests passed
pnpm dev:web: ready in <2s
端到端登录闭环（live curl）:
  POST /api/auth/login          -> 200 + Set-Cookie: session=<HS256 JWT>
  GET  /projects (with cookie)  -> 200，HTML 包含 "WC Test" 用户名（middleware 注入 x-mvp-display-name，layout 通过 getSession() 读出）
  dev server 日志全部 2xx/4xx，无 Edge Runtime error
PostgreSQL 16.13 已在本地 127.0.0.1:5432 启动；ai_novel_platform 现有 1 user / 1 project / 1 chapter / 4 succeeded jobs。
```

2026-05-17 本会话后续工作（端到端可用性收尾）：

发现并修复一个 fake-model fallback 回归：worker 注册 handler 时未注入 `deps.model`，
而 1959df6 引入的"resolveModel 返回 null + !deps.model = NO_MODEL_PROFILE"分支导致
任何 job 在 ModelProfile 缺失时立即 FAILED，`USE_FAKE_MODEL=true` 兜底意图无法生效。

变更：

- `apps/worker/src/index.ts`：根据 `USE_FAKE_MODEL` 条件向 3 个 handler 注入
  `model: createFakeModel()`，保持 USE_FAKE_MODEL=false 时的严格行为不变。
- `packages/db/scripts/seed.ts` + `db:seed` 命令（根 + 子包）：
  幂等 seed 最小可用集合 — 1 ModelProvider (OpenAI Compatible) + 1 ModelProfile
  (org-level, taskType=default) + 1 WritingMethodology (三幕剧) + 1 StyleProfile
  (通俗易读)；ENCRYPTION_KEY/OPENAI_API_KEY 缺失时 key 留空，配合 USE_FAKE_MODEL
  仍可跑通流程。
- `.env`：补 `USE_FAKE_MODEL="true"` 开发兜底。

端到端验证（worker + web live，2026-05-17 21:46-21:48 本机时间）：

```text
pnpm db:seed (二次执行幂等):
  ✓ ModelProvider 已存在: 20d889ad-... (key=空)
  ✓ ModelProfile   已存在: 4bd74a65-... (taskType=default)
  ✓ WritingMethodology 已存在: 9dc7fde1-... (三幕剧)
  ✓ StyleProfile   已存在: 558db3e7-... (通俗易读)
完整三类 job 闭环（chapter 00000000-...-0004）:
  POST /api/generation-jobs (GENERATE_CHAPTER) → SUCCEEDED in ~1s
    output: { versionId, versionNo: 5, wordCount: 125 }
  POST /api/generation-jobs (DESLOP)          → SUCCEEDED in ~1s
    output: { issueCount: 0, overallScore: 100 }
  POST /api/generation-jobs (EXTRACT_MEMORY)  → SUCCEEDED in ~1s
    output: { worldFacts: 0, characterChanges: 0 }  (fake-model 占位文本无可抽取项，按设计)
DB 终态: generate_chapter 5 succeeded / 1 failed(老回归), deslop 1 succeeded, extract_memory 1 succeeded
pnpm typecheck / pnpm test 全过
```

至此，**用户可在本地完成 [创建项目 → 写大纲 → 生成第一章 → DESLOP → 抽取记忆] 的核心写作闭环**（fake-model 模式，无 LLM API key）。要走真实 LLM，把 ENCRYPTION_KEY / OPENAI_API_KEY 填入 `.env`，再把 `USE_FAKE_MODEL` 改 `false`。

## Current Runtime Notes

PostgreSQL is running locally on:

```text
127.0.0.1:5432
```

Start PostgreSQL manually after reboot if needed:

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' -D 'D:\myTool\develop\PostgreSQL\data' -l 'D:\myTool\develop\PostgreSQL\postgresql.log' start
```

## Review Notes

- No `.git/`, `.worktrees/`, `.pnpm-store/`, or root `.next/` directory was copied from the source project.
- `node_modules/`, `packages/*/node_modules/`, `apps/*/node_modules/`, `packages/db/src/generated/`, and `apps/web/.next/` were generated locally by install/generate/dev commands.
- `.gitignore` excludes `.env`, `node_modules/`, `.next/`, `*.tsbuildinfo`, and `packages/db/src/generated/`.
- Secret scan hits were reviewed as test fake values, schema field names, documentation placeholders, or generated code; no real API key was identified.

## Pending Cleanup

The temporary initdb password file still exists:

```text
D:\myTool\develop\PostgreSQL\downloads\pgpass.txt
```

It contains the local development password `postgres`. Deleting it requires explicit confirmation because it is outside the workspace.

## Next Recommended Step

MVP 第一层应用/API 闭环已贯通；session 鉴权已在 Edge Runtime + Node Runtime 双跑通；DESLOP / EXTRACT_MEMORY 已接入 resolveModel。建议下一步任选其一：

1. 队列健壮性：扩展 `packages/db` helpers 接受 transaction client、补 `claimNextJob` 状态机校验、补 `releaseJobLease` 续期/回收路径。
2. 工作台 UI 体验完善：`useJobPolling` 加退避重试；`persist_version` step 的 `outputPreview` 改用真实 versionNo。
3. 真实 LLM provider 集成验证：1959df6 已加入 OpenAI/Anthropic adapter 与 model routing；下一步在本机配置 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 并跑一次端到端非 fake 路径，把 DESLOP / EXTRACT_MEMORY 也接入。
4. Session 安全加固：将本地 `SESSION_SECRET` 占位值替换为随机生成的强值；增加 `/api/auth/me` 端点供前端获取当前会话；为 `/api` 路由加 401 边界。
