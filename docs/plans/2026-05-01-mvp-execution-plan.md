# AI 小说平台 — MVP 执行计划

> 日期：2026-05-01  
> 基于：`docs/plans/2026-04-30-windows-postgres-mvp-plan.md`（父计划）  
> 整合：`docs/plans/2026-05-01-expansion-roadmap.md`（拓展路线图）  
> 状态：待执行

本计划将父计划中未完成的 Task 4-12 拆分为 3 个批次，补齐架构决策和文件清单。

---

## 0. 当前基线

### 已完成

| 任务 | 状态 |
|------|------|
| Task 1: Web App Skeleton (Next.js 16 + React 19) | ✅ |
| Task 2: Env Loader (`packages/shared/src/env.ts`) | ✅ |
| Task 3: Password Utilities (`packages/shared/src/auth/password.ts`) | ✅ |
| Prisma 7 schema (19 表) + 迁移 | ✅ |
| 生成任务状态机 (`packages/shared/src/generation/state.ts`) | ✅ |
| 租户 helper (`packages/db/src/tenant.ts`) | ✅ |

### 验证基线

```bash
pnpm db:validate   # ✅
pnpm test          # ✅ 20 测试通过
pnpm typecheck     # ✅ 3 包通过
```

### 当前项目结构

```text
ai-novel-platform/
├── apps/
│   └── web/                    # Next.js 16 最小壳，无 API 路由
│       ├── src/
│       │   └── app/
│       │       ├── layout.tsx
│       │       ├── page.tsx
│       │       ├── page.test.ts
│       │       └── globals.css
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       └── vitest.config.ts
├── packages/
│   ├── db/                     # Prisma 7 + 租户 helper
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── client.ts
│   │       ├── tenant.ts
│   │       ├── tenant.test.ts
│   │       └── index.ts
│   └── shared/                 # 状态机 + env + 密码
│       └── src/
│           ├── env.ts / env.test.ts
│           ├── generation/state.ts / state.test.ts
│           └── auth/password.ts / password.test.ts
├── docs/plans/
│   ├── 2026-04-30-windows-postgres-mvp-plan.md
│   └── 2026-05-01-expansion-roadmap.md
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

---

## 1. 架构决策

### 1.1 服务层位置

所有业务服务放在 `apps/web/src/server/`，不是独立包。理由：
- 当前无独立 API 包，不需要跨 App 共享服务
- Worker 通过 `packages/db` 直接操作数据，不调用 Web 服务层
- 后续如需拆分 API 服务，这些文件可以直接移动到新包

### 1.2 测试策略

- **服务层测试**：mock Prisma 接口，不连接数据库
- **Job Repository 测试**：需要真实 DB（含事务的 claim/lease 逻辑），使用独立测试 schema
- **Worker 测试**：mock handler，验证轮询逻辑
- **页面测试**：vitest + react-dom/server 渲染，不启动浏览器

### 1.3 组织上下文

当前无 auth 机制。在 `(app)` 路由组的共享 layout 中，使用环境变量 `DEFAULT_ORGANIZATION_ID` 作为组织上下文。后续接入 auth 后，只需修改 layout 中的获取逻辑。

### 1.4 不做的事

- 不做 auth 中间件和 session
- 不做真实 AI 模型调用（fake model 即可闭环验证）
- 不做 E2E 测试
- 不做数据库 migration（保持现有 schema）
- 不做前端设计打磨

---

## 2. Batch 1: 后端服务层

**前置**: 无  
**产出**: 可创建用户、组织、项目、章节和大纲的完整服务层  
**质量门禁**: `pnpm test && pnpm typecheck`

### Task 4: User + Organization 服务

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/web/src/server/users.ts` | 用户 CRUD + 注册流程 |
| `apps/web/src/server/users.test.ts` | 用户服务测试 |
| `apps/web/src/server/organizations.ts` | 组织 CRUD + 成员管理 |
| `apps/web/src/server/organizations.test.ts` | 组织服务测试 |

**修改文件:**

| 文件 | 变更 |
|------|------|
| `apps/web/package.json` | 添加 `@ai-novel/db` 和 `@ai-novel/shared` 依赖 |

**API 签名:**

```typescript
// users.ts
createUser(params: {
  email: string
  displayName: string
  password: string
  prisma: PrismaClient
}): Promise<{ user: User; organization: Organization; membership: OrganizationMember }>

findUserByEmail(email: string, prisma: PrismaClient): Promise<User | null>
findUserById(id: string, prisma: PrismaClient): Promise<User | null>

// organizations.ts
createOrganization(params: {
  name: string
  slug: string
  ownerUserId: string
  prisma: PrismaClient
}): Promise<Organization>

findOrganizationBySlug(slug: string, prisma: PrismaClient): Promise<Organization | null>
findOrganizationsByUserId(userId: string, prisma: PrismaClient): Promise<Organization[]>
addMember(params: {
  organizationId: string
  userId: string
  role: OrganizationRole
  prisma: PrismaClient
}): Promise<OrganizationMember>
```

**设计要点:**
- `createUser` 在事务内：创建用户 → hash 密码 → 创建默认组织 → 添加 owner 成员
- 组织 slug 唯一性由数据库 `organizations.slug` unique 约束保证，服务层捕获 Prisma 唯一约束错误并转为友好错误
- 密码使用 `@ai-novel/shared/auth/password` 的 `hashPassword`

**测试覆盖:**
- 正常创建用户 + 默认组织 + owner 成员
- 邮箱唯一性冲突
- 密码 hash 不存明文
- 组织 slug 冲突
- 查询用户所属组织列表

---

### Task 5: Project 服务

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/web/src/server/projects.ts` | 项目 CRUD |
| `apps/web/src/server/projects.test.ts` | 项目服务测试 |

**API 签名:**

```typescript
// projects.ts
createProject(params: {
  organizationId: string
  title: string
  slug: string
  createdById: string
  type?: ProjectType
  genre?: string
  premise?: string
  styleBrief?: string
  prisma: PrismaClient
}): Promise<Project>

findProjectBySlug(organizationId: string, slug: string, prisma: PrismaClient): Promise<Project | null>
findProjectsByOrganization(organizationId: string, prisma: PrismaClient): Promise<Project[]>
softDeleteProject(organizationId: string, projectId: string, prisma: PrismaClient): Promise<Project>
updateProject(organizationId: string, projectId: string, data: UpdateProjectInput, prisma: PrismaClient): Promise<Project>
```

**设计要点:**
- 使用 `tenantWhere` / `tenantCreateData` 保证租户隔离
- 软删除：设置 `deletedAt`，查询时添加 `deletedAt: null` 过滤
- slug 在组织内唯一（`projects_organization_id_slug_key`）

---

### Task 6: Chapter + Outline 服务

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/web/src/server/chapters.ts` | 卷 + 章节 CRUD |
| `apps/web/src/server/chapters.test.ts` | 章节服务测试 |
| `apps/web/src/server/outlines.ts` | 大纲 CRUD |
| `apps/web/src/server/outlines.test.ts` | 大纲服务测试 |

**API 签名:**

```typescript
// chapters.ts
createVolume(params: {
  organizationId: string
  projectId: string
  title: string
  orderIndex: number
  summary?: string
  prisma: PrismaClient
}): Promise<Volume>

createChapter(params: {
  organizationId: string
  projectId: string
  volumeId?: string
  chapterNo: number
  title: string
  createdById: string
  prisma: PrismaClient
}): Promise<Chapter>

updateChapterContent(params: {
  organizationId: string
  chapterId: string
  content: string
  wordCount: number
  updatedById: string
  prisma: PrismaClient
}): Promise<Chapter>

saveContentVersion(params: {
  organizationId: string
  projectId: string
  chapterId: string
  content: string
  source: ContentVersionSource
  createdById: string
  generationJobId?: string
  prisma: PrismaClient
}): Promise<ContentVersion>

findChaptersByProject(organizationId: string, projectId: string, prisma: PrismaClient): Promise<Chapter[]>

// outlines.ts
createOutline(params: {
  organizationId: string
  projectId: string
  parentId?: string
  level: OutlineLevel
  title: string
  orderIndex: number
  summary?: string
  createdById: string
  prisma: PrismaClient
}): Promise<Outline>

findOutlinesByProject(organizationId: string, projectId: string, prisma: PrismaClient): Promise<Outline[]>
updateOutline(organizationId: string, outlineId: string, data: UpdateOutlineInput, prisma: PrismaClient): Promise<Outline>
```

**设计要点:**
- `content_versions.versionNo` 自增：查询 `entityType + entityId` 下最大版本号 + 1
- wordCount 由调用方传入，服务层不负责字数统计
- outlines 查询按 `orderIndex` 排序，支持树形结构通过 parentId

---

## 3. Batch 2: Worker + 管线

**前置**: Batch 1 完成  
**产出**: PostgreSQL-backed 异步生成任务闭环  
**质量门禁**: `pnpm db:validate && pnpm test && pnpm typecheck`

### Task 7: Generation Job Repository

**新增文件:**

| 文件 | 用途 |
|------|------|
| `packages/db/src/generation-jobs.ts` | Job 仓库 |
| `packages/db/src/generation-jobs.test.ts` | 仓库测试 |

**修改文件:**

| 文件 | 变更 |
|------|------|
| `packages/db/src/index.ts` | 导出 generation-jobs |

**API 签名:**

```typescript
// generation-jobs.ts
createJob(params: {
  organizationId: string
  projectId: string
  userId: string
  jobType: GenerationJobType
  input: Record<string, unknown>
  modelProfileId?: string
  targetEntityType?: GenerationTargetEntityType
  targetEntityId?: string
  prisma: PrismaClient
}): Promise<GenerationJob>

claimNextJob(params: {
  organizationId: string
  lockKey: string
  leaseDurationMs: number
  prisma: PrismaClient
}): Promise<GenerationJob | null>

releaseJobLease(jobId: string, lockKey: string, prisma: PrismaClient): Promise<void>

updateJobStatus(params: {
  jobId: string
  status: GenerationJobStatus
  output?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
  prisma: PrismaClient
}): Promise<GenerationJob>

createStep(params: {
  organizationId: string
  jobId: string
  stepKey: string
  modelProfileId?: string
  prisma: PrismaClient
}): Promise<GenerationStep>

updateStep(params: {
  stepId: string
  status: GenerationStepStatus
  outputPreview?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  errorMessage?: string
  prisma: PrismaClient
}): Promise<GenerationStep>
```

**设计要点:**
- `claimNextJob` 在事务内 SELECT + UPDATE，保证并发安全
- lease 过期判断：`leaseExpiresAt < NOW()`
- `releaseJobLease` 清空 `lockKey` 和 `leaseExpiresAt`
- `updateJobStatus` 使用 `generation/state.ts` 的 `assertGenerationJobTransition`
- 测试需要真实数据库（验证事务隔离和 lease 竞争）

**claim 查询逻辑（伪 SQL）:**

```sql
WITH next_job AS (
  SELECT id FROM generation_jobs
  WHERE organization_id = $orgId
    AND status = 'queued'
    AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE generation_jobs
SET status = 'running', lock_key = $lockKey,
    lease_expires_at = NOW() + $duration, started_at = NOW()
FROM next_job
WHERE generation_jobs.id = next_job.id
RETURNING *
```

---

### Task 8: Worker Skeleton

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/worker/package.json` | Worker 包配置 |
| `apps/worker/tsconfig.json` | TypeScript 配置 |
| `apps/worker/src/index.ts` | 入口 |
| `apps/worker/src/poll.ts` | 轮询器 |
| `apps/worker/src/poll.test.ts` | 轮询测试 |

**修改文件:**

| 文件 | 变更 |
|------|------|
| `package.json` | 添加 `dev:worker` 脚本 |

**轮询器设计:**

```typescript
// poll.ts
type JobHandler = (job: GenerationJob, prisma: PrismaClient) => Promise<void>;

interface PollerConfig {
  pollIntervalMs: number;
  leaseDurationMs: number;
  lockKey: string;
}

function createPoller(config: PollerConfig, handlers: Map<GenerationJobType, JobHandler>) {
  // 返回 start/stop 函数
}
```

**测试设计:**
- mock generation-jobs repository
- 验证：有 job 时调用 handler
- 验证：无 job 时不调用 handler
- 验证：handler 抛错时 job 标记为 failed
- 验证：不可恢复错误不重试

**package.json 依赖:**
- `@ai-novel/db: workspace:*`
- `@ai-novel/shared: workspace:*`

---

### Task 9: Model Provider Service

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/web/src/server/model-providers.ts` | Provider CRUD |
| `apps/web/src/server/model-providers.test.ts` | Provider 测试 |
| `packages/shared/src/crypto/encryption.ts` | AES-256-GCM 加密 |
| `packages/shared/src/crypto/encryption.test.ts` | 加密测试 |

**修改文件:**

| 文件 | 变更 |
|------|------|
| `packages/shared/package.json` | 添加 crypto/encryption export |

**加密方案:**

```
encrypt(plaintext, key) → base64(iv + ciphertext + authTag)
decrypt(encoded, key) → plaintext

key: Buffer.from(process.env.ENCRYPTION_KEY, 'hex') // 32 bytes
算法: AES-256-GCM
```

**Provider 服务 API:**

```typescript
createProvider(params: {
  organizationId: string
  name: string
  providerType: ProviderType
  baseUrl?: string
  apiKey: string       // 明文输入，加密存储
  ownerUserId?: string
  prisma: PrismaClient
}): Promise<ModelProvider>  // encryptedApiKey 永远不返回

findProvidersByOrganization(organizationId: string, prisma: PrismaClient): Promise<ModelProvider[]>
updateProvider(organizationId: string, providerId: string, data: UpdateProviderInput, prisma: PrismaClient): Promise<ModelProvider>
rotateApiKey(organizationId: string, providerId: string, newApiKey: string, prisma: PrismaClient): Promise<void>
```

**设计要点:**
- `encryptedApiKey` 在返回给客户端时永远不包含（设为 `"***"`）
- 对外提供 `decryptApiKey(providerId, prisma)` 内部方法供 Worker 调用
- API key 不进日志、不进 prompt snapshot

---

### Task 10: Fake Chapter Generation Pipeline

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/worker/src/pipeline/fake-model.ts` | Fake LLM |
| `apps/worker/src/pipeline/generate-chapter.ts` | 章节生成管线 |
| `apps/worker/src/pipeline/generate-chapter.test.ts` | 管线测试 |

**fake-model 行为:**

```typescript
interface FakeModelConfig {
  outputText: string;    // 固定输出文本
  latencyMs: number;     // 模拟延迟（测试中为 0）
}

function createFakeModel(config: FakeModelConfig): ModelAdapter {
  // 返回统一接口，可替换为真实模型
}
```

**管线流程:**

```
1. 读取 job.input（包含 projectId, chapterId）
2. 查询 project + chapter + outline 组装 context
3. 调用 fake model 生成正文
4. 写入 content_versions（source=AI）
5. 更新 chapter.content 和 wordCount
6. 记录 generation_steps
7. 更新 job.status = succeeded
```

**测试覆盖:**
- 正常流程：生成文本 → 写入版本 → 更新 job
- context 组装正确（包含 project styleBrief、chapter outline）
- 失败回滚：model 抛错时 job 标记 failed
- 不调用真实 LLM

---

## 4. Batch 3: UI 交互

**前置**: Batch 1 完成（页面调用服务层）  
**产出**: 用户可见的项目库和写作工作台  
**质量门禁**: `pnpm test && pnpm typecheck && pnpm --filter @ai-novel/web build`

### Task 11: Project Library Pages

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/web/src/app/(app)/layout.tsx` | 共享 layout（组织上下文 + 导航） |
| `apps/web/src/app/(app)/projects/page.tsx` | 项目列表页 |
| `apps/web/src/app/(app)/projects/new/page.tsx` | 新建项目页 |
| `apps/web/src/app/api/projects/route.ts` | GET 列表 / POST 创建 |
| `apps/web/src/components/projects/project-list.tsx` | 项目卡片列表 |

**路由设计:**

```text
/                          → 落地页（已有）
/(app)/projects            → 项目列表
/(app)/projects/new        → 新建项目
/api/projects              → GET (列表) / POST (创建)
```

**(app)/layout.tsx 设计:**
- 顶栏：品牌 logo + 组织选择器（MVP 硬编码）
- 内容区：`{children}`
- 组织上下文通过 `DEFAULT_ORGANIZATION_ID` 环境变量获取

**API route 设计:**

```typescript
// GET /api/projects
// 从 layout 获取 organizationId
// 调用 findProjectsByOrganization

// POST /api/projects
// body: { title, slug, genre?, premise? }
// 调用 createProject
```

---

### Task 12: Minimal Writing Workspace

**新增文件:**

| 文件 | 用途 |
|------|------|
| `apps/web/src/app/(app)/projects/[projectId]/workspace/page.tsx` | 工作台页面 |
| `apps/web/src/components/workspace/asset-sidebar.tsx` | 左侧章节目录 |
| `apps/web/src/components/workspace/editor-pane.tsx` | 中间编辑区 |
| `apps/web/src/components/workspace/ai-panel.tsx` | 右侧 AI 面板 |
| `apps/web/src/app/api/projects/[projectId]/chapters/route.ts` | 章节 API |
| `apps/web/src/app/api/generation-jobs/route.ts` | 创建生成任务 API |

**布局:**

```text
┌──────────┬─────────────────┬──────────┐
│ 章节目录  │    编辑区        │ AI 面板   │
│ (sidebar) │  (editor-pane)  │ (ai-panel)│
│           │                 │           │
│ 第1章     │  # 第一章       │ [生成]    │
│ 第2章     │                 │ 状态: 空闲 │
│ 第3章     │  正文内容...     │           │
│           │                 │ 版本列表   │
└──────────┴─────────────────┴──────────┘
```

**交互:**
- 点击左侧章节 → 编辑区加载对应内容
- 点击 AI 面板「生成」→ POST /api/generation-jobs → 创建 queued job
- 编辑区使用 textarea（后续可换 Monaco/CodeMirror）

---

## 5. 依赖关系图

```text
Task 4 (User/Org) ──┐
                    ├──→ Task 5 (Project) ──→ Task 6 (Chapter/Outline)
                    │                              │
                    │                              ↓
                    │                    Batch 1 完成 ──→ Task 11 (Project Pages)
                    │                         │          → Task 12 (Workspace)
                    │                         ↓
                    └────────────→ Task 7 (Job Repository)
                                        │
                                        ↓
                                   Task 8 (Worker) ──→ Task 9 (Model Provider)
                                                              │
                                                              ↓
                                                        Task 10 (Fake Pipeline)
                                                              │
                                                              ↓
                                                       Batch 2 完成
```

---

## 6. 拓展路线图衔接

Batch 3 完成后，当前 MVP 闭环完成。按拓展路线图继续：

| 阶段 | 内容 | 触发条件 |
|------|------|----------|
| Phase B | 写作资产 schema (characters, world_items, plot_threads, project_memories, style_profiles, writing_methodologies, deslop_rules) | Task 12 完成 |
| Phase C | Context Packet Builder (关键词激活 + token 预算) | Phase B 完成 |
| Phase D | 多步骤管线 (plan→draft→review→revise→persist→extract) | Task 10 + Phase C |
| Phase E | 去 AI 味引擎 (规则扫描 + LLM 建议) | Phase B 完成 |
| Phase F | 风格画像 + 写作方法论模板 | Phase D 完成 |
| Phase G | 高级记忆与图谱化 (pgvector/Neo4j) | 有真实用户和规模需求时 |

---

## 7. 质量门禁

每个 Task 完成时必须通过：

```bash
pnpm db:validate
pnpm test
pnpm typecheck
```

Batch 3 额外：

```bash
pnpm --filter @ai-novel/web build
```

### 代码质量约束

| 指标 | 阈值 |
|------|------|
| 每文件行数 | ≤ 300 行 |
| 每函数行数 | ≤ 20 行 |
| 嵌套层级 | ≤ 3 层 |
| 测试覆盖 | 每个服务函数至少 2 个测试（正常路径 + 错误路径） |
| 新增依赖 | 仅限 workspace 内部包，不引入第三方库 |

### 不引入的依赖

- 不做 Zod（MVP 用 TypeScript 类型足够）
- 不做第三方 logger（console.error 足够，后续换 pino）
- 不做 ORM 之外的数据库工具
- 不做 React 组件库（shadcn/MUI 等）
