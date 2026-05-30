# Current Progress

> Last updated: 2026-05-30

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

## 2026-05-19 新人友好向导 Phase A + A.5 完成

按照 `docs/plans/2026-05-18-onboarding-ux-revamp.md` 的设计推进，本轮交付向导前半段（基础信息 + 题材风格方法论），并把后端事务一次性落到位。

### 完成项

- **A1 选项常量层**：新增 `apps/web/src/lib/wizard-options.ts`，导出 `GENRE_OPTIONS`（14 项题材）、`STYLE_OPTIONS`（9 项风格）、`PROJECT_TYPE_OPTIONS`、`getMethodologyOptions()`（基于 `@ai-novel/shared/methodology/templates`，并补 custom 选项 + 暂不选择哨兵）、`joinTags/splitTags` 多选拼接工具。Vitest 17/17 全绿。
- **A2 切换函数 + 卡片组件**：`apps/web/src/lib/option-toggle.ts` 提供纯函数 `toggleSingle / toggleMulti`（不可变、保持插入顺序），Vitest 8/8。`apps/web/src/components/wizard/option-cards.tsx` 提供单选/多选两态可视化卡片，含 ARIA 角色（radiogroup / group）与 aria-checked。
- **A3 向导壳**：`apps/web/src/app/(app)/projects/new/page.tsx` 重写为 useReducer + WizardStepper（顶部进度条）+ StepBasics（Step 1：作品名 / slug + 自动生成按钮 / 类型卡片）+ StepGenreStyle（Step 2：题材 chips 多选 / 风格 chips 多选 / 方法论卡片单选）。
- **A4 兼容提交**：旧 `/api/projects` body 字段全部保留；wizard 新增字段只在选了方法论时附带 `wizard.methodType`。
- **A5 e2e 回归**：`apps/web/e2e/smoke.spec.ts` 已切换到向导新交互（点击「下一步」→ 选「奇幻」/「热血燃」/「三幕式」→ 创建），Playwright smoke 7.8s 通过。
- **A6 事务化 createProject**：`apps/web/src/server/projects.ts` 改为 `prisma.$transaction`，同步落库 `projects` + 可选 `writing_methodologies` 一行 + 可选 `outlines[]`。custom 方法论用 `Prisma.JsonNull` 占位；snowflake / three_act 等模板从 shared 包加载完整 `outlineMetadata + reviewCriteria`。
- **A7 API 接受 wizard 字段**：`apps/web/src/app/api/projects/route.ts` 新增 `sanitizeWizard` 白名单校验（`VALID_METHODS` / `VALID_LEVELS`），仅认可枚举值通过。
- **A8 单测全覆盖**：`apps/web/src/server/projects.test.ts` 扩到 11 测试 — 涵盖不传 wizard、methodType=none、methodType=three_act 落库、methodType=custom 占位、outlineNodes 批量入库；`apps/web/src/app/api/projects/route.test.ts` mock 同步加 `$transaction / writingMethodology / outline`。

### 周边修改

- `packages/db/src/index.ts` 新增 `export { Prisma }`，让 web 端可用 `Prisma.JsonNull / Prisma.InputJsonValue` 类型。
- `apps/web/src/app/globals.css` 追加 `.option-cards / .wizard-page / .wizard-stepper / .wizard-step-*` 等约 130 行样式。

### 验证证据

- monorepo 测试：`pnpm test` 全绿（packages/shared 22/22 · apps/worker 131/131 · apps/web 196/196）。
- 类型检查：`pnpm typecheck` 通过。
- e2e：`pnpm test:e2e` 通过（注册 → 向导 Step1 → Step2 选三幕式 → 创建项目 → 章节 → GENERATE_CHAPTER / DESLOP / EXTRACT_MEMORY 全 SUCCEEDED）。
- 数据库直查：

  ```sql
  select p.title, p.genre, p.style_brief, wm.name as methodology, wm.method_type
    from projects p
    left join writing_methodologies wm on wm.project_id = p.id
    where p.title like 'E2E%' order by p.created_at desc limit 3;
  ```

  本轮（2026-05-19）跑出来的最新一行 `methodology=三幕式 / method_type=three_act`，对比 2026-05-18 同表行没有 methodology，确认事务落库链路真实通了。

### 风险与下一步

- 当前向导只交付前两步；Step 3（AI 起草梗概）/ Step 4（AI 起草大纲骨架）以及同步 `/api/wizard/draft-*` 端点在 Phase B 进行。
- 模型切换 UI、Provider/Profile CRUD、fake-model 横幅在 Phase C 进行。
- 决策点 A（抽 `packages/model-adapters`）在 Phase B/C 触及模型适配器复用时再落实，本轮无需提前。
- 已记录的回滚成本：单文件复原 `apps/web/src/app/(app)/projects/new/page.tsx` 即可退回到旧单页表单（旧 schema 与 API 兼容路径保留）。

## 2026-05-19 Phase B + Phase C 并行交付

延续 `docs/plans/2026-05-18-onboarding-ux-revamp.md`，本轮并行启动两个隔离 worktree agent，分别交付向导后两步 + 模型管理 UI，最后 cherry-pick 进 master。

### Phase B（commit `34b82cb`）— 决策点 A1 落地 + 向导 Step 3/4 + 同步 AI 起草

- **抽 `packages/model-adapters`**：把 `apps/worker/src/models/` 全套（adapter-factory / openai-adapter / anthropic-adapter / model-resolver / types）作为 100% git rename 提到独立 workspace；apps/web 与 apps/worker 都加 `@ai-novel/model-adapters: workspace:*` 依赖。
- **同步起草端点**：`apps/web/src/server/wizard-drafts.ts` 实现 `draftPremise / draftOutline`，fake 模式拼接占位文本，真实模式走 `resolveModelProfile` + `createAdapter` + 25s `AbortController` 超时；任何失败路径降级返回 fake + `degraded: true` 标志。
- **新 API**：`POST /api/wizard/draft-premise` / `POST /api/wizard/draft-outline`。
- **向导 Step 3 + Step 4**：`step-premise.tsx`（一句话核心 + 关键元素 → AI 写梗概 → 采纳/重抽/清空）、`step-outline.tsx`（方法论骨架自动预填，可编辑/删除每条，AI 扩写 summary）；`projects/new/page.tsx` 扩到 4 步，premise + outlineNodes 写入 `/api/projects` 提交体。
- **测试**：packages/model-adapters 36/36（迁移自 worker，0 改动）、wizard-drafts.test 10 case、两条 route.test。

### Phase C（commit `f7a2c69`）— 模型 Provider/Profile 可视化管理

- **server 层**：新建 `model-profiles.ts`（5 个导出）；给 `model-providers.ts` 补 `findProviderById / softDeleteProvider / rotateApiKey`。
- **API**：
  - `/api/model-providers` GET / POST，`/api/model-providers/[id]` PATCH / DELETE，`/api/model-providers/[id]/test` POST
  - `/api/model-profiles` GET（支持 `projectId` / `taskType` 过滤） / POST，`/api/model-profiles/[id]` PATCH / DELETE
  - `/api/settings/runtime` GET 返回 `useFakeModel` + `encryptionKeyConfigured`
- **页面**：`(app)/settings/models/page.tsx` 服务端注入 runtime flags，FakeModelBanner + Providers / Profiles 两栏。layout.tsx top-bar 加"设置"入口。
- **安全断言全过**：GET 列表 / GET 单个返回的 `encryptedApiKey` 一律覆写为 `***`；POST 在 `ENCRYPTION_KEY` 未配时返回 400；PATCH 拒绝改 apiKey（必须走单独 rotate 路径）；测试用 response 文本 `includes("sk-")` 做明文泄露断言。
- **测试**：本轮新增 51 个 vitest 用例。
- **TODO**：`/api/model-providers/[id]/test` 真实模式当前只校验 `ENCRYPTION_KEY` 存在性返回 `mode: "real-stub"`，没真发 1-token ping —— Phase B 已把 adapter 抽出，下一步可以接上。

### 合并过程与冲突解决

两 agent 并行在隔离 worktree 工作。Cherry-pick 时 `apps/web/src/app/globals.css` 末尾追加块发生冲突（两方都按约定追加到末尾，但 git 三方合并误对齐了 flex 块）。手工解决方法：

1. 重置 globals.css 到 Phase B 后的状态（1614 行）。
2. 提取 Phase C 原 commit 中 globals.css 第 1539–1712 行（纯追加部分），append 到当前文件。
3. 最终 1788 行 = Phase A 后 1538 行 + Phase B 增 76 行 + Phase C 增 174 行，行数精确匹配预期。

E2E smoke spec 因向导步数从 2 增到 4 而失败（"创建"按钮只在 Step 4 出现）。已修复（commit `ad951c3`），在 Step 2 之后多点两次"下一步"，梗概与大纲都留默认值/自动预填，再点"创建"。

### Phase B/C 合并后完整验证

- `pnpm typecheck`：5 个 workspace 全绿（含新 `packages/model-adapters`）。
- `pnpm test`：5 workspaces / **433 tests 全绿**：
  - packages/db 12 · packages/shared 22 · packages/model-adapters 36
  - apps/worker 95（去掉迁出的 4 测后）· apps/web **268**
- `pnpm test:e2e`：通过 7.4s（注册 → 4 步向导 → 三幕式 → 章节 → GENERATE_CHAPTER / DESLOP / EXTRACT_MEMORY 全 SUCCEEDED）。

### Git 历史

```
ad951c3 test(web): smoke spec walks through wizard 4 steps after Phase B
f7a2c69 feat(web): model switcher UI + provider/profile CRUD (Phase C)
34b82cb feat(web): wizard AI drafting steps + model-adapters extraction (Phase B)
557150e feat(web): new-project wizard with methodology persistence (Phase A + A.5)
0bcbcab docs(plans): add 2026-05-18 onboarding UX revamp plan
```

两个临时 worktree 与分支已删除（注册元数据被 git 清掉；磁盘上 `.claude/worktrees/agent-*` 残留 node_modules 句柄未释放，不影响 git 状态，可后续 `rm -rf` 一次清掉）。

### 风险与下一步

- 工作台内部各资产面板（角色 / 世界 / 大纲 / 伏笔 / 记忆 / 风格 / 去 AI 味规则）仍然是"空表单 + 手写"，下一轮重构入口。
- `/api/model-providers/[id]/test` 真实模式 1-token ping 未实现，建议下一个小修补单独 commit。
- Settings 页面没接入 Playwright e2e；Phase C 共 51 单测覆盖 API + server 逻辑，UI 交互留给后续 smoke 扩展。

---

## 2026-05-20 — 三个遗留 TODO 全部完成

承接 2026-05-19 备注的「下一步」三项,本轮一次性推进到底。

### 7 个 Phase 概览

| Phase | 内容 | Commit |
|-------|------|--------|
| 1 | TODO 1: `/api/model-providers/[id]/test` 真实 1-token ping | `243f00a` |
| 2 | AI-1: 抽 `server/asset-drafts.ts` 通用骨架 + 16 单测 | `48f6cce` |
| 3 | AI-2: 角色 AI 起草 + 通用 `<AiDraftDialog>` 组件 | `09777ea` |
| 4 | AI-3/4/5: 世界 / 大纲 / 伏笔 AI 起草 | `ce1098d` |
| 5 | AI-6: 风格 / 去 AI 味规则 AI 起草 | `0dfc148` |
| 6 | TODO 3: Settings 页 Playwright e2e + Next.js env 修复 | `3171661` |
| 7 | 全量验证 + 本进度文档更新 | (本 commit) |

### 交付内容

**TODO 1 — 真实 1-token ping**

- `apps/web/src/server/model-providers-test.ts`:抽出 server 端 helper。fake 模式直接返回 OK;真实模式从同 provider 任一 Profile 取 `modelName` 作为 ping target,调 `adapter.generate("hi", {maxOutputTokens:1})`,15s 超时,9 类错误分类(认证/网络/超时/限流/Provider 不存在/不支持/未配 Key/无 Profile/未知)。
- `route.ts` 改为 delegate,保持"任何异常都返回 HTTP 200 + body.ok=false"语义。
- 单测:9 + 5 = 14 个覆盖所有分支。

**TODO 2 — 工作台资产面板全量 AI 起草 + 编辑**

- 设计决策(2026-05-19 与用户确认):全做 6 类 / 不进库 / 1-10 条用户控制 / 可选 prompt 补充说明框。
- `server/asset-drafts.ts` 通用骨架 `generateAssetDrafts<TInput, TItem>`:复用 wizard-drafts fake-fallback 模式,统一 prompt builder / JSON 解析 / count clamp(1-10) / 解析失败 degraded 兜底。
- 6 个 server helper:`character-drafts.ts` / `world-item-drafts.ts` / `outline-drafts.ts` / `plot-thread-drafts.ts` / `style-profile-drafts.ts` / `deslop-rule-drafts.ts`。每个独立 prompt + JSON schema + fake 占位。
- 6 个 API 路由:`/api/asset-drafts/{characters,world-items,outlines,plot-threads,style-profiles,deslop-rules}`,统一输入清洗(trim/数组过滤/枚举校验)。
- 通用 `<AiDraftDialog>` 组件:泛型 + `FieldSpec[]` 配置驱动,支持 input/textarea/select/tags 四种字段。Dialog 内可逐条编辑、单条采纳 / 一键全部采纳 / 重抽。
- 6 个 panel 接入 `✨ AI 帮我...` 按钮:角色 / 世界 / 大纲 / 伏笔 / 风格 / 去 AI 味规则(后者在「管理规则」折叠区内)。
- 共 19 个新单测(基础设施 16 + 业务 helper 3 类 fake 验证 5 + 路由转发 13)。
- 加入 ~150 行 CSS(backdrop / dialog / cards / 字段控件)。

**TODO 3 — Settings e2e**

- `apps/web/e2e/settings.spec.ts`:覆盖 banner / seed Provider 测试连接 / Provider 改名 / Profile CRUD(创建/编辑/删除)。
- 跳过"新建 Provider"分支(本地 `.env` 无 `ENCRYPTION_KEY`,UI 会 disable apiKey 输入)。
- 自动接受所有 `window.confirm` 弹窗。

**额外修复**

- `apps/web/.env.local` 增补 `USE_FAKE_MODEL="true"` —— Next.js 只读 app 目录 env,不读 monorepo 根 .env,之前 banner 一直显示"真实模式"是个一直存在的小 bug。
- 新增 `apps/web/.env.local.example` 文档化该陷阱。

### 验证

- `pnpm typecheck`:5 workspaces 全绿。
- `pnpm test`:5 workspaces / **448 tests 全绿**(packages/db 12 + shared 22 + model-adapters 36 + worker 95 + web **283**)。
- `pnpm test:e2e`:2 specs 全绿 14.7s(smoke 8.2s + settings 2.6s)。

### Git 历史

```
3171661 test(web): e2e for Settings model management
0dfc148 feat(web): AI drafting for style profiles and de-AI-slop rules
ce1098d feat(web): AI drafting for world items, outline nodes, plot threads
09777ea feat(web): AI character drafting with editable preview dialog
48f6cce feat(web): asset-drafts foundation for AI-assisted resource creation
243f00a feat(web): real 1-token ping for model provider test endpoint
```

### 风险与下一步

- 真实模式整链路尚未端到端跑过(因为本地无 `ENCRYPTION_KEY` + 真实 API key)。fake 模式已 100% 覆盖,真实模式靠单测保证(单测 mock 了 createAdapter)。
- 6 类资产 AI 草稿暴露了一个 prompt task type 数组:`draft_character / draft_world_item / draft_outline / draft_plot_thread / draft_style_profile / draft_deslop_rule`。未来若想给某类资产配专属(更便宜)模型,在 Settings → Profile 里新建对应 taskType 即可,无需改代码。
- Dialog 组件本身可继续抽通用化用于其他场景(prompt 复用、记忆抽取等),目前仅供 6 个 asset draft 用。

---

## 2026-05-30 — 预算治理 API、面板、通知与测试

承接“持久化预算体系”后续，本轮新增组织/项目预算治理能力，并保持 Windows 本地 fake-model 开发路径可验证。

### 交付内容

- **数据库模型与迁移**：`packages/db/prisma/schema.prisma` 新增 `OrganizationBudgetPolicy` 与 `BudgetNotification`，并给 `Organization` / `Project` 增加预算策略与通知关系；新增迁移 `202605300001_add_budget_governance`，包含预算策略表、通知表、范围索引、通知 dedupe 唯一索引、active policy partial unique index 与额度/周期/status check 约束。
- **预算服务层**：新增 `apps/web/src/server/budgets.ts`，实现预算周期计算、月度费用额度、月度 Token 额度、阈值归一化、`UsageEvent` 日聚合、预算 dashboard、超阈值通知 upsert 去重、通知列表与 acknowledge。
- **API**：新增 `GET/PATCH /api/settings/budget`、`GET /api/usage/budget-summary`、`GET/PATCH /api/budget-notifications`。
- **前端治理面板**：新增 `/settings/budget` 页面与 `BudgetGovernancePanel` 客户端组件，展示周期、费用/Token 使用率、KPI、CSS 使用率条、每日费用趋势、可访问明细表、预算策略表单与超预算通知确认。
- **UI 风格**：按 UI 技能方向采用克制的 SaaS/FinOps 仪表盘风格，不引入图表依赖；预算 CSS 已追加到现有设置页样式后面。
- **单测**：新增预算服务与 3 条 API route 单测，覆盖周期跨月、阈值清洗、policy create/update、用量聚合、通知生成/确认、API 参数校验与错误映射。

### 验证证据

```text
pnpm --filter @ai-novel/web test -- src/server/budgets.test.ts src/app/api/settings/budget/route.test.ts src/app/api/budget-notifications/route.test.ts src/app/api/usage/budget-summary/route.test.ts
  4 test files passed, 25 tests passed

pnpm --filter @ai-novel/db db:validate
  Prisma schema is valid

pnpm --filter @ai-novel/db db:generate
  Prisma Client 7.8.0 generated to packages/db/src/generated

pnpm --filter @ai-novel/web typecheck
  tsc --noEmit passed
```

### 当前风险与下一步

- 预算 dashboard 读取 `usage_events`；如果 worker 的真实模型调用路径没有持续写入 `UsageEvent`，图表会显示 0 或仅显示已有记录。下一步应补齐 worker 生成完成后的 UsageEvent 写入闭环，并纳入 pipeline 测试。
- `/settings/budget` 页面目前已实现但未加入顶部导航入口；若希望用户可发现，需要在设置导航或全局 layout 增加入口。
- 当前工作区仍有大量无关脏文件；预算治理提交时应精确 stage 本轮文件，避免混入已有模型设置、工作台、apply-deslop、worktree 残留等变更。
