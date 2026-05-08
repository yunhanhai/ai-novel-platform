# 2026-05-04 — MVP 收尾、工作台 9 tabs、版本树与去 AI 味

> 本文记录 2026-05-04 这次会话内对 `apps/web` 和 `packages/shared` 的所有改动。
>
> **背景**：在此之前，仓库已落地 Phase A→F 的 schema/服务层和 worker 多步管线（参见 `2026-05-01-expansion-roadmap.md`），但用户可见层只有 Task 11/12 的最小壳，且大量 API 仍是写死 mock。本次目标：把"用户可见的主路径"从 mock 全部接到真实 prisma + 服务层，并补齐 Phase F 起所有缺失的工作台 UI。

---

## 1. 总览：本次完成的范围

按交付顺序：

| Stage | 主题 | 状态 |
|------|------|------|
| 1 | 组织上下文真相源 + Phase F API 真接入 | ✅ |
| 2 | Phase F UI：风格画像 / 方法论面板 | ✅ |
| 3 | P0 收尾：项目库 / 工作台 / 章节 CRUD / job 真接入 + 章节内容持久化 | ✅ |
| 4 | Phase B 资产 UI：角色 / 世界观 / 伏笔 / 项目记忆面板 | ✅（前次会话已交付，此处沿用） |
| 5 | 章节版本树（content_versions UI） | ✅ |
| 6 | 去 AI 味报告（实时扫描 + 项目级自定义规则） | ✅ |

完成后整体可工作的能力：

> 用户可在浏览器中创建作品 → 创建章节 → 编辑/自动保存 → 触发 AI 生成多步管线 → 实时看到每步状态与 token/耗时 → 切换查看版本并回滚 → 实时扫描去 AI 味 → 在工作台维护故事圣经资产、风格画像和方法论。

整条主路径（projects → chapters → content_versions → generation_jobs → generation_steps + Phase B/E/F 资产）全部对接 prisma，**无 mock 路径**。

---

## 2. 关键设计决策

### 2.1 组织 / 用户上下文的单一真相源

MVP 没有 auth。新增 `apps/web/src/server/context.ts` 作为服务端唯一真相源：

```ts
getOrganizationId()  // 从 process.env.DEFAULT_ORGANIZATION_ID 读
safeGetOrganizationId() // 同上但缺失返回 null（layout SSR fallback）
getUserId()          // 从 process.env.DEFAULT_USER_ID 读
safeGetUserId()      // 同上但缺失返回 null
```

- 所有 API 路由调用 `getOrganizationId()` / `getUserId()`
- `(app)/layout.tsx` 是 server component，调 `safeGetOrganizationId()` 后通过 `OrganizationProvider` 注入到客户端
- 客户端组件可用 `useOrganization()` 读 orgId
- 后续接 auth 时**只改这一处**（context.ts 改成读 session）

### 2.2 章节正文自动保存

`useChapterContent` hook：

- 切章节自动 fetch 一次正文
- 编辑后 `debounce 1.5s` 自动 PATCH 到 `/api/chapters/[chapterId]`
- 切章节 / 触发 AI 前 `flush()` 强制保存
- `saveStatus` 在编辑器顶栏显示「保存中.../已保存/保存失败」
- 暴露 `reload()` 给版本回滚等外部操作使用

字数统计：CJK 字符按字数 + 其余按空白分词（中英混排）。

### 2.3 章节版本回滚的安全策略

`restoreChapterVersion` **不直接覆盖**当前正文：

1. 找到目标版本
2. 找到该章最新的 `content_versions`
3. 如果当前 `chapter.content` 与最新版本不同，先把当前正文快照成新版本（source=MANUAL）
4. 把目标版本写入 `chapter.content`

这样回滚永远是非破坏性的，用户随时能再回滚回来。

### 2.4 任务轮询

`useJobPolling` hook：

- 创建 job → 立刻把 initial state 渲染出来
- 每 1.5s 轮询 `/api/generation-jobs/[id]`
- `SUCCEEDED / FAILED / CANCELLED` 时停止
- 卸载时清理 timer
- 单次 fetch 失败不停轮询，下一轮继续

工作台监听 `job.status === "SUCCEEDED"` → 自动 reload 章节列表 + 编辑器正文。

### 2.5 去 AI 味扫描放在哪里执行？

**决定：放在 web，而不是 worker job**。

- `scanDeslop` 是纯函数（确定性扫描），不需要 LLM
- 用户期望「改一个字马上看反馈」，异步 job 是过度设计
- 把 scanner 从 `apps/worker/src/pipeline/deslop-scanner.ts` 抽到 `packages/shared/src/deslop/scanner.ts`，让 web/worker 共用
- worker 端原文件改成 `re-export`，不破坏现有 84 个 worker 测试
- web 调用 `/api/deslop-rules/scan` 时，融合内置规则 + 项目级 `exact_match` 自定义规则

### 2.6 工作台侧栏从 3 个 tab 扩到 9 个 tab

```
AI · 版本 · 去 AI 味 · 角色 · 世界 · 伏笔 · 记忆 · 风格 · 方法论
```

- AI 与版本、去 AI 味放最左（最高频操作）
- Phase B 4 个资产面板放中段（写作时偶尔查看）
- 风格 / 方法论放最右（项目级配置，低频）
- Tab 容器横向滚动（避免在窄屏挤压）

### 2.7 错误状态码约定

| 场景 | 状态码 |
|------|--------|
| 必填参数缺失 / slug 格式错 | 400 |
| 资源不存在（含 Prisma P2025） | 404 |
| 唯一约束冲突 / `已存在` / `已被占用` | 409 |
| 其他服务异常 | 500 |

---

## 3. 文件清单

### 3.1 新增

#### Server 层
- `apps/web/src/server/context.ts` + `context.test.ts`（10 测试）
- `apps/web/src/server/content-versions.ts` + `content-versions.test.ts`（6 测试）
- `apps/web/src/server/deslop-rules.ts` + `deslop-rules.test.ts`（4 测试）

#### API 路由（21 条）
- `/api/projects` GET / POST（真接入）
- `/api/projects/[projectId]/chapters` GET / POST
- `/api/chapters/[chapterId]` GET / PATCH（含 content / title / status）
- `/api/chapters/[chapterId]/versions` GET（版本列表，含 200 字预览）
- `/api/content-versions/[id]` GET（详情）/ POST（**回滚**）
- `/api/generation-jobs` GET / POST（真接入 createJob）
- `/api/generation-jobs/[id]` GET（含 steps 子查询）
- `/api/style-profiles` GET / POST + `[id]` PATCH / DELETE
- `/api/writing-methodologies` GET / POST + `[id]` PATCH / DELETE（POST 支持 `?fromTemplate=true`）
- `/api/deslop-rules` GET / POST + `[id]` PATCH / DELETE
- `/api/deslop-rules/scan` POST（**实时扫描**）

#### 组件
- `components/organization-context.tsx`（OrganizationProvider + useOrganization）
- `components/workspace/use-workspace-resource.ts`（通用资源 hook）
- `components/workspace/use-workspace-data.ts`（章节列表 / 章节正文 / job 轮询 三个 hook）
- `components/workspace/workspace-side-tabs.tsx`（9 tabs 容器）
- `components/workspace/style-profile-panel.tsx`
- `components/workspace/methodology-panel.tsx`
- `components/workspace/versions-panel.tsx`
- `components/workspace/deslop-panel.tsx`
- `components/workspace/pipeline-timeline.tsx`（job 步骤时间线，由 ai-panel 内嵌）

#### 共享
- `packages/shared/src/deslop/scanner.ts`（从 worker 迁移；worker 改 re-export）

### 3.2 重写 / 修改

| 文件 | 变更 |
|------|------|
| `app/(app)/layout.tsx` | 改 server component，注入 OrganizationProvider，顶栏显示 org 标签 |
| `app/(app)/projects/page.tsx` | 改 server component，直接调 prisma 拉项目列表 |
| `app/(app)/projects/new/page.tsx` | 表单改 client，提交到 `POST /api/projects`，成功后跳工作台 |
| `app/(app)/projects/[projectId]/workspace/page.tsx` | 完全重写，去掉 mockChapters，集成 hooks + 9 tabs |
| `components/workspace/asset-sidebar.tsx` | 增加「新建章节」表单，自动取下一个 chapterNo |
| `components/workspace/editor-pane.tsx` | 增加 saveStatus 显示、loading 状态、disabled 状态 |
| `components/workspace/ai-panel.tsx` | 由 aside 改为 div；接入 JobSummary；嵌入 PipelineTimeline |
| `app/api/style-profiles/*` | mock-store → prisma + server 层 |
| `app/api/writing-methodologies/*` | 同上 |
| `app/globals.css` | 增量约 600 行：org-tag / side-tabs / resource-panel / methodology / versions / deslop / pipeline-timeline / save-status 等 |
| `packages/shared/package.json` | exports 增加 `./deslop/scanner` |

### 3.3 保留但已断开引用（待用户同意删）

- `apps/web/src/app/api/style-profiles/_mock-store.ts`
- `apps/web/src/app/api/writing-methodologies/_mock-store.ts`

按全局规则"删除文件需用户同意"，因此保留文件、仅断开引用。可后续 PR 单独清理。

---

## 4. 工作台 9 tabs 功能矩阵

| Tab | 数据源 | 主要操作 |
|-----|--------|----------|
| **AI** | `generation_jobs` + `generation_steps` | 一键触发管线；查看每步状态、token、耗时；嵌入 PipelineTimeline |
| **版本** | `content_versions` | 列出本章所有版本（手动/AI/导入）；二次确认回滚（先快照当前正文） |
| **去 AI 味** | shared scanner + `deslop_rules` | 一键扫描当前正文；按 error/warning/info 分组展示；管理项目级规则（增/启停） |
| **角色** | `characters` | CRUD（前次会话） |
| **世界** | `world_items` | CRUD（前次会话） |
| **伏笔** | `plot_threads` | CRUD（前次会话） |
| **记忆** | `project_memories` | proposed → accepted 审核（前次会话） |
| **风格** | `style_profiles` | 创建画像（含禁用词/偏好词）+ 启停 + 简介编辑 |
| **方法论** | `writing_methodologies` + `@ai-novel/shared/methodology/templates` | 6 种内置模板一键创建 + 详情展开（大纲骨架 + 结构审查） |

---

## 5. 数据流（关键路径）

### 5.1 用户首次创建作品到生成第一章

```text
用户访问 /                  ← 落地页
        ↓
点击 "新建作品" → /projects/new
        ↓
POST /api/projects          → createProject(prisma)
        ↓
跳转 /projects/[id]/workspace
        ↓
useChapters() → GET /api/projects/[id]/chapters
        ↓
点击侧栏 "+新建" → POST /api/projects/[id]/chapters
        ↓
useChapterContent() → GET /api/chapters/[chapterId]
        ↓
编辑正文 → debounce 1.5s → PATCH /api/chapters/[chapterId]
        ↓
点击 AI tab → 生成章节 → POST /api/generation-jobs
        ↓
useJobPolling() → GET /api/generation-jobs/[id] (1.5s 轮询)
        ↓
worker 跑完 → SUCCEEDED → 工作台自动 reload 章节正文
```

### 5.2 版本回滚

```text
版本 tab → GET /api/chapters/[chapterId]/versions
        ↓
选择某版本 → 二次确认 → POST /api/content-versions/[id]
        ↓
restoreChapterVersion: 当前正文 → 快照为新版本（如不同）→ chapter.content := 目标版本
        ↓
onChapterContentRefreshed → reload 编辑器正文 + 章节列表
```

### 5.3 去 AI 味扫描

```text
deslop tab → 点击 "扫描当前章节"
        ↓
POST /api/deslop-rules/scan { projectId, text }
        ↓
findDeslopRulesByProject(active) → 提取 exact_match 规则
        ↓
scanDeslop(text, customExactPatterns)  ← shared 包
        ↓
报告 enrichment: custom 类目 → 用 rule.category/severity/suggestion 重写
        ↓
按 severity 分组渲染（error / warning / info）
```

---

## 6. 测试 / 类型检查 / Build 结果

最后一次完整门禁：

| 检查 | 结果 |
|------|------|
| `pnpm -r typecheck`（4 个包） | ✓ 全通过 |
| `pnpm -r test` | ✓ **225 测试通过**（web 110 / worker 84 / shared 19 / db 12） |
| `pnpm --filter @ai-novel/web build` | ✓ 26 路由识别正确（21 API + 5 页面） |

新增测试覆盖：
- `context.test.ts` 10 个
- `content-versions.test.ts` 6 个（含回滚快照保护、跳过空内容、跳过相同内容）
- `deslop-rules.test.ts` 4 个（默认 severity / 过滤 / 部分更新 / 停用）

---

## 7. 部署 / 运行所需环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串 |
| `DEFAULT_ORGANIZATION_ID` | ✅ | MVP 阶段的默认组织（UUID） |
| `DEFAULT_USER_ID` | ✅ | MVP 阶段的默认用户（UUID） |
| `QUEUE_DRIVER` | ❌ | `postgres`（默认）/ `redis` |
| `WORKER_POLL_INTERVAL_MS` | ❌ | 默认 1000 |
| `WORKER_LEASE_DURATION_MS` | ❌ | 默认 120000 |

未配置 `DEFAULT_ORGANIZATION_ID` 时：
- 顶栏显示「无组织上下文」橙色警告
- 项目列表页显示 form-error 而非崩溃
- API 路由返回 500 + 明确错误消息

未配置 `DEFAULT_USER_ID` 时：仅在写入操作（创建项目/章节/job）时报错；只读路径正常。

---

## 8. 已知约束 / 待清理

1. **mock-store 文件保留**：`api/style-profiles/_mock-store.ts` 和 `api/writing-methodologies/_mock-store.ts` 已断开引用，未删除（待用户批准后清理）。
2. **章节状态枚举**：`/api/chapters/[chapterId]` 的 `PatchBody.status` 类型用 `"PLANNED" | "DRAFT" | "REVIEWING" | "FINAL"`，与 Prisma `ChapterStatus` 枚举对齐。如 schema 调整需同步。
3. **API 路由 0 测试覆盖**：所有 `app/api/**/route.ts` 仍无路由级测试（服务层测试已覆盖 prisma 行为）。MVP 计划 Task 11/12 期望的「API 拒绝缺失组织上下文」等用例未补。
4. **方法论尚未真正参与 plan/review**：`writing_methodologies` 当前只是 CRUD，路线图明确"方法论应影响 outline metadata、prompt template 和 review criteria" 这一步未实现。
5. **风格画像回填未串到 UI**：`apps/worker/src/pipeline/analyze-style-pipeline.ts` 已就位，但工作台没有「基于本章重新校准风格画像」的入口。
6. **无 outline 编辑 UI**：`outlines` 表与服务已就位，但工作台没有大纲面板（章节级 outline 是通过 `chapters.outlineSummary` 展现的占位）。
7. **真实 LLM 适配器未接入**：worker 端仍使用 fake-model；按路线图为 P1。

---

## 9. 推荐下一步（按优先级）

| 优先级 | 项 | 说明 |
|--------|-----|------|
| P1 | 真实 LLM 适配器 | `apps/worker/src/models/openai-adapter.ts` 等，按 `model_profiles.taskType` 路由；fake-model 保留给测试 |
| P1 | API 路由测试 | 用 `next-test-api-route-handler` 或最简单的 mock prisma + 直接 import handler；至少覆盖 401/404/409/200 四类 |
| P2 | Outline 大纲编辑 UI | 把 `outlines.level=book\|volume\|chapter\|beat` 在工作台暴露 |
| P2 | 去 AI 味"应用建议"按钮 | issue 上加"接受替换"，触发 PATCH chapter content 形成新版本 |
| P2 | 方法论 → 管线接入 | plan 步骤读 `outlineMetadata`；review 步骤读 `reviewCriteria` |
| P3 | DESLOP / EXTRACT_MEMORY 独立按钮 | AI tab 增加"只跑去 AI 味"/"只抽取记忆" |
| P3 | Auth + 用户管理 UI | 把 context.ts 切到 session |
| P3 | Phase G | 触发条件未达成，参见 `2026-05-01-phase-g-readiness.md` |

---

## 10. 路线图状态更新

将本次完成的项目同步到 `2026-05-01-expansion-roadmap.md` 第 5 节优先级总表（建议在下次会话由 doc-updater 代理执行）：

| 模块 | 上次状态 | 本次状态 |
|------|----------|----------|
| 写作资产真源 (Phase B) | schema/服务层 ✅ | + UI 面板 ✅ |
| Context Packet (Phase C) | ✅ | 不变 |
| 四步生成管线 (Phase D) | 服务层 ✅ | + 工作台时间线 UI ✅ |
| 去 AI 味引擎 (Phase E) | scanner ✅ | + 项目规则表 + 实时扫描 API + 面板 UI ✅ |
| 风格画像 / 方法论 (Phase F) | schema/服务层 ✅ | + API 真接入 + 面板 UI ✅ |
| 章节版本树 (Slice 6) | 未启动 | ✅ 列表 + 回滚（含快照保护） |

---

## 11. 关键提交分组建议（如需拆 PR）

```
1. chore(shared): move deslop scanner to packages/shared
2. feat(web/server): add organization/user context source of truth
3. feat(web/api): replace style-profiles + writing-methodologies mock with prisma
4. feat(web/ui): add Phase F panels (style profile, methodology) to workspace
5. feat(web/api): real /api/projects + /api/projects/[id]/chapters + /api/chapters/[id]
6. feat(web/api): real /api/generation-jobs with createJob + status polling endpoint
7. feat(web/ui): workspace integration with chapter persistence + job polling
8. feat(web): chapter content versions list + restore (with snapshot guard)
9. feat(web): real-time deslop scanning with project-level rule management
10. style(web): workspace 9-tab side panel + visual styles
```

每组都对应 typecheck + test 全绿的可独立合入状态。
