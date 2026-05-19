# 新人友好化改造 — 新建项目向导 + 模型切换 UI

> 日期：2026-05-18（决策点 A/B/C 于 2026-05-19 确认）
> 类型：Superpowers 设计与计划文档
> 状态：方向已确认，进入 Phase A 前最后核对
> 工作目录：`D:\develop\AI\xiaoshuo\base_win`
> 关联文档：
> - `docs/plans/2026-04-29-ai-novel-platform-design.md`（系统设计真源）
> - `docs/plans/2026-05-01-expansion-roadmap.md`（外部参考与许可证边界）
> - `docs/plans/2026-05-04-mvp-finalization-and-workspace-tabs.md`（当前工作台结构）
> - `docs/current-progress.md`（当前进度）

---

## 0. 目标与非目标

### 0.1 本次要解决的问题

当前工作台对新人极度不友好：

- 新建项目页 `apps/web/src/app/(app)/projects/new/page.tsx` 是 6 个空 input，进入工作台后所有面板（角色、世界、大纲、伏笔、记忆、方法论、风格、去 AI 味规则）都是"空表单 + 手填"。
- 模型只能通过 `pnpm db:seed` 或直接写库配置，前端没有任何 `model_providers` / `model_profiles` 管理 UI。`USE_FAKE_MODEL` 的状态用户也看不见。
- 用户不知道：从哪个面板开始填？填什么样的内容算合格？有没有模板可以一键生成骨架？

### 0.2 本次目标（in scope）

1. 将 `projects/new` 重构为 **3–4 步向导**，把"空表单"换成"选项 + 模板 + AI 草稿"。
2. 落地 **模型切换 UI**：可视化管理 `ModelProvider` + `ModelProfile`，看见 `USE_FAKE_MODEL` 状态，无需 seed。
3. AI 草稿全程接入 fake-model，跑通完整 UI 流；真实模型作为运行时切换项，不在本次必做。

### 0.3 非目标（out of scope，留给后续）

- 不在本次重构工作台内部各资产面板（角色 / 世界 / 大纲 / 伏笔 等本身的"模板化 + AI 起草"）。
- 不引入富文本编辑器、Ghost Text 流式预览、DOCX 导出。
- 不引入 RAG / 向量检索 / 知识图谱。
- 不引入 Electron 或本地存储分支。
- 不替换鉴权与多组织模型。

外部仓库 `YuanShiJiLoong/author` / `mleafish/author` 是 AGPL-3.0，本次**只借鉴交互模式**（选项化、模板化、Ghost-Text-Like 接受/拒绝按钮的草稿编辑），**不复制任何代码、prompt、schema、UI 文案**。

---

## 1. 当前事实（已通过代码确认）

| 主题 | 当前状态 | 文件 |
|------|----------|------|
| 新建项目页 | 单页 6 字段空表单 | `apps/web/src/app/(app)/projects/new/page.tsx` |
| 项目创建 API | 接 `title/slug/type/genre/premise/styleBrief` | `apps/web/src/app/api/projects/route.ts:26-64` |
| `createProject` 服务 | 仅落库 `projects` 表，不写大纲/角色/模板 | `apps/web/src/server/projects.ts:23-41` |
| 方法论模板数据 | 已实现 7 个模板（snowflake / three_act / four_act / webnovel_speed / romance_rhythm / short_reversal / custom），含 outline 骨架 | `packages/shared/src/methodology/templates.ts` |
| Worker 已注册 handler | 仅 `GENERATE_CHAPTER` / `DESLOP` / `EXTRACT_MEMORY` | `apps/worker/src/index.ts:61-80` |
| Worker API allow-list | 含 `GENERATE_OUTLINE` 等，但 worker 没注册 handler | `apps/web/src/app/api/generation-jobs/route.ts:23-32` |
| fake-model | 已实现，`USE_FAKE_MODEL=true` 时全部 handler 注入 | `apps/worker/src/pipeline/fake-model.ts` |
| `ModelProvider` server 层 | 实现了 `createProvider` / `findProvidersByOrganization` / `updateProvider` | `apps/web/src/server/model-providers.ts` |
| `ModelProvider` API 路由 | **不存在** | `apps/web/src/app/api/model-providers/` 目录缺失 |
| `ModelProfile` API 路由 | **不存在** | `apps/web/src/app/api/model-profiles/` 目录缺失 |
| Model resolver fallback | 4 级：`profileId → project+task → project+default → org+task → org+default` | `apps/worker/src/models/model-resolver.ts` |
| seed 写入的默认值 | 1 个 `ModelProvider` + 1 个 `ModelProfile`（org 级，taskType=default）| `CLAUDE.md` 项目根 |

---

## 2. 设计方案

### 2.1 总体架构

```
┌──────────────────────────────┐
│   Step 1  基础信息            │  title, slug, type
│      ▼                       │
│   Step 2  题材 + 风格 + 方法论│  chips / 卡片选择
│      ▼                       │
│   Step 3  AI 草稿（梗概）     │  调 draft helper, 用户编辑后接受/重抽
│      ▼                       │
│   Step 4  AI 草稿（大纲骨架） │  方法论模板预填 + AI 补充
│      ▼                       │
│   ✓ 创建：一次事务落多张表    │  projects, outlines, optional methodology
└──────────────────────────────┘

┌──────────────────────────────┐
│   设置 → 模型管理              │
│   ┌─Providers─┐ ┌─Profiles──┐ │
│   │ 列表/新建 │ │ 列表/新建 │ │
│   │ 测试连接  │ │ 绑 task   │ │
│   └───────────┘ └───────────┘ │
│   USE_FAKE_MODEL 状态横幅      │
└──────────────────────────────┘
```

### 2.2 向导前端结构

新文件：

- `apps/web/src/app/(app)/projects/new/page.tsx` — 改为向导壳，管 step 状态
- `apps/web/src/components/wizard/wizard-stepper.tsx` — 顶部 stepper
- `apps/web/src/components/wizard/step-basics.tsx`
- `apps/web/src/components/wizard/step-genre-style.tsx`
- `apps/web/src/components/wizard/step-premise.tsx`
- `apps/web/src/components/wizard/step-outline.tsx`
- `apps/web/src/components/wizard/option-cards.tsx` — 通用 chips/卡片选择器
- `apps/web/src/lib/wizard-options.ts` — 题材 / 风格 / 方法论的预置选项（前端常量）
- `apps/web/src/lib/wizard-state.ts` — 向导聚合状态（reducer 或简单 useReducer）

#### Step 1 — 基础信息（必填）

- 作品名称（input）
- 标识符（input，可点 "自动生成" 从 title 转拼音简码或 nanoid）
- 类型（卡片 2 选 1：长篇 / 短篇）

#### Step 2 — 题材 / 风格 / 方法论（全是选择题）

题材 chips（多选）：`奇幻 / 玄幻 / 仙侠 / 武侠 / 都市 / 言情 / 悬疑 / 推理 / 科幻 / 末日 / 历史 / 军事 / 同人 / 青春`

风格 chips（多选）：`轻松搞笑 / 冷峻克制 / 热血燃 / 暗黑 / 治愈 / 第一人称口语化 / 第三人称全知 / 文学化 / 网文爽感`

方法论卡片（单选，可"暂不选择"）：
- 雪花写作法（snowflake）
- 三幕式（three_act）
- 四幕式（four_act）
- 网文快节奏（webnovel_speed）
- 言情节奏（romance_rhythm）
- 短反转（short_reversal）
- 自定义（不预填骨架）

> 这些选项作为前端常量在 `wizard-options.ts` 维护；方法论描述直接复用 `packages/shared/src/methodology/templates.ts` 的 `name + description`。

#### Step 3 — AI 起草梗概（可跳过）

布局：

```
┌──────────────────────────────────────────┐
│ 一句话核心 (input, 可空)                  │
│ "想看到的关键元素 / 主角设定"（textarea）  │
│ [✨ AI 帮我写梗概]   [跳过]               │
├──────────────────────────────────────────┤
│ 草稿区（textarea，AI 生成后填入）          │
│ [✓ 采纳]  [♻ 重抽]  [✏ 我自己改]          │
└──────────────────────────────────────────┘
```

- 调 `POST /api/wizard/draft-premise`（新增同步端点，详见 2.4）
- 用 fake-model 时返回一段占位文本，UI 行为与真实模型一致
- 采纳后 premise 进入 wizard state

#### Step 4 — 大纲骨架（可跳过）

- 如果 Step 2 选了方法论，**自动展示该方法论的 `outlineMetadata.nodes` 作为待生成大纲条目**（来源就是 `packages/shared/src/methodology/templates.ts`）。
- 用户可：
  - 编辑每条标题/摘要
  - 删除某条
  - 点 `✨ 让 AI 把摘要扩写`（调 `POST /api/wizard/draft-outline`，传入 `methodType + genre + style + premise`，按节点展开 summary）
- 创建项目时这些条目一次性写入 `outlines` 表。

### 2.3 提交流程

`POST /api/projects` 扩展为接收 wizard 全量 payload：

```ts
interface CreateProjectBody {
  // 原有
  title: string;
  slug: string;
  type?: "LONG_NOVEL" | "SHORT_STORY";
  genre?: string;         // 兼容旧字段，向导填多选时取第一个或拼接
  premise?: string;
  styleBrief?: string;

  // 新增（向导专用，可选）
  wizard?: {
    genreTags?: string[];    // 多选题材
    styleTags?: string[];    // 多选风格
    methodType?: MethodType; // 方法论选择
    outlineNodes?: Array<{   // 大纲条目（Step 4 编辑后）
      level: "BOOK" | "VOLUME" | "CHAPTER" | "BEAT";
      title: string;
      summary?: string;
      orderIndex: number;
    }>;
  };
}
```

服务层 `createProject` 改为：用 `prisma.$transaction` 同时落 `projects` + `outlines`（如有）+ `writing_methodologies`（如选了方法论），保证向导原子性。`genreTags` / `styleTags` 拼接为逗号分隔字符串写入 `projects.genre` / `projects.styleBrief`（兼容现有 schema，不加新列）。`writing_methodologies` 行的字段来源详见 §5 决策点 B。

### 2.4 AI 草稿端点（同步，不进 generation_jobs）

新增两个 web API：

- `POST /api/wizard/draft-premise`
- `POST /api/wizard/draft-outline`

理由：向导是同步对话式体验，不适合走"提交 job → 轮询 → 取结果"。新增端点直接在 web 进程内拿模型适配器同步生成（短 prompt、低延迟）。

实现要点：

- 在 `apps/web/src/server/wizard-drafts.ts` 复用 worker 的 `createAdapter` 工厂（提到 `packages/shared` 或新 `packages/model-adapters` —— **决策点 A**，详见 §5）。
- `USE_FAKE_MODEL=true` 时返回基于输入拼出的占位文本（不调用真实 API）。
- 真实模式下若拿不到 `ModelProfile` 或 `ENCRYPTION_KEY` → 自动降级返回 fake 文本，并附 `degraded: true` 标志，前端在草稿区角落显示"当前为占位草稿"。

### 2.5 模型切换 UI

#### 新增页面

- `apps/web/src/app/(app)/settings/models/page.tsx`（顶层菜单加"设置 / 模型"入口）

子组件：

- `components/settings/providers-list.tsx`
- `components/settings/provider-form.tsx`（创建/编辑 Provider，含 baseUrl、providerType、API key）
- `components/settings/profiles-list.tsx`
- `components/settings/profile-form.tsx`（创建 Profile：选 Provider、modelName、taskType、温度、maxTokens）
- `components/settings/fake-model-banner.tsx`（顶部横幅：当前 `USE_FAKE_MODEL=true` 时显示"演示模式"）

#### 新增 API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/model-providers` | GET | 列出当前组织的 Provider，API key 输出 `***` |
| `/api/model-providers` | POST | 新建 Provider（接 `name, providerType, baseUrl, apiKey, isDefault`） |
| `/api/model-providers/[id]` | PATCH | 编辑 Provider（不允许改 apiKey 通过 PATCH，必须显式调 `rotate-key`） |
| `/api/model-providers/[id]` | DELETE | 软删除 Provider（status=DISABLED） |
| `/api/model-providers/[id]/test` | POST | 测试连通（fake 模式直接返回 OK，真实模式发 1 token ping） |
| `/api/model-profiles` | GET | 列出 Profile，按 `projectId` / `taskType` 过滤 |
| `/api/model-profiles` | POST | 新建 Profile |
| `/api/model-profiles/[id]` | PATCH | 编辑 |
| `/api/model-profiles/[id]` | DELETE | 删除 |
| `/api/settings/runtime` | GET | 返回 `{ useFakeModel: boolean, encryptionKeyConfigured: boolean }` |

#### 安全注意

- API key 写入前需 `ENCRYPTION_KEY` 已设置；未设置时 POST 返回 `400`，前端提示"先在 .env 配置 ENCRYPTION_KEY"。
- 列表 / GET 永不返回明文 key（沿用 `model-providers.ts:46` 的 `***` 屏蔽）。
- 路由层用 `getOrganizationId()` 隔离（沿用现有上下文）。

#### UX 要点

- 进入页面顶部横幅明确告诉用户："当前 `USE_FAKE_MODEL=true`，所有 AI 生成走演示模型。切换至真实模型需修改项目 `.env` 后重启 worker。"
- Profile 创建表单的 `taskType` 给下拉预设：`default / generate_chapter / generate_outline / deslop / extract_memory / rewrite / polish / review / continue_chapter`。
- Provider `providerType` 给卡片选择：OPENAI_COMPATIBLE / ANTHROPIC / DEEPSEEK / GEMINI / CUSTOM。

---

## 3. 实施分阶段

按 TDD 推进。每个阶段先写测试再实现，阶段间允许 commit（用户已启动 Superpowers 工作流）。

### Phase A — 向导框架与 Step 1/2

- A1. 加 `wizard-options.ts` 常量 + Vitest 单测覆盖 `getMethodologyOptions()` 等导出
- A2. 加 `OptionCards` 通用组件 + 单测
- A3. 重写 `projects/new` 为 stepper 壳，Step 1（基础信息）+ Step 2（题材/风格/方法论）打通
- A4. Submit 仍然只发原 payload（不带 wizard 节点），保证可降级落库
- A5. Playwright smoke 扩展：新建项目走完 step 1+2 仍能落库

### Phase A.5 — 提交事务化（确保 B2 落地）

- A6. 在 `apps/web/src/server/projects.ts` 把 `createProject` 改为 `prisma.$transaction`，同步写入：`projects` + 可选 `outlines[]` + 可选 `writing_methodologies` 一行
- A7. 扩展 `POST /api/projects` body schema 接受 `wizard.methodType / wizard.outlineNodes / wizard.genreTags / wizard.styleTags`
- A8. 单测覆盖：选了方法论时 `writing_methodologies` 是否落库、唯一约束冲突回滚、未选方法论时不创建记录

### Phase B — AI 草稿（同步端点）

- B1. 新增 `apps/web/src/server/wizard-drafts.ts`，含 fake 模式实现
- B2. 新增 `POST /api/wizard/draft-premise` + 单测
- B3. 新增 `POST /api/wizard/draft-outline` + 单测
- B4. Step 3 / Step 4 前端接入，含"采纳 / 重抽 / 我自己改"按钮
- B5. 把 wizard 全量提交到 `/api/projects`，扩展 server 层和 API 测试

### Phase C — 模型切换 UI

- C1. 新增 `/api/settings/runtime` GET + 单测
- C2. 新增 `/api/model-providers` CRUD + 单测，复用 `server/model-providers.ts`
- C3. 新增 `/api/model-profiles` CRUD + 单测（先实现 server 层 `server/model-profiles.ts`）
- C4. 新增 `/api/model-providers/[id]/test` + 单测（fake 模式 mock）
- C5. 新增 `(app)/settings/models/page.tsx` + 子组件，覆盖 Providers / Profiles 两张表
- C6. 新增 fake-model 横幅组件
- C7. Playwright smoke 扩展：进入设置页能看到 seed 出的默认 provider/profile

### Phase D — 文档与回归

- D1. 更新 `docs/current-progress.md`
- D2. 在 README / CLAUDE.md 补充"如何切换到真实模型"小节
- D3. 全量 `pnpm test` + `pnpm typecheck` + `pnpm test:e2e` 绿灯

---

## 4. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 同步 draft 端点在真实模型下超时 | 默认 fake-model 模式；真实模式给 25s 超时，超时降级返回 fake + `degraded: true` |
| Wizard 中途失败导致脏数据 | `prisma.$transaction` 包住 projects + outlines 落库；前端 wizard state 在内存，未提交不入库 |
| API key 误输出 | 所有 GET 返回前 spread 覆写 `encryptedApiKey: "***"`，加 Vitest 断言"GET 永不含明文" |
| `ENCRYPTION_KEY` 未配但用户尝试存 key | POST `/api/model-providers` 显式 400，UI 给出修复指引文案 |
| 设置页污染现有 layout | 新增 `(app)/settings/*` 路由组，沿用现有 `(app)/layout.tsx` |
| 大纲骨架预填的写入语义和现有 `outlines` 表不一致 | 复用现有 `outline-panel.tsx` 的字段；本次只写 `level / title / summary / orderIndex` + `parentId=null`，与现有 schema 完全兼容 |

回滚方案：所有改动集中在新文件 + 受控扩展现有路由，旧 `projects/new` 行为保持兼容（不传 `wizard` 字段时退化为单页表单提交）。回滚只需还原 `projects/new/page.tsx` 一个文件即可。

---

## 5. 待用户决策点

在进入 Phase A 前需要拍板：

**决策点 A — 模型适配器的物理位置**

向导的同步 draft 端点要复用 worker 的 `createAdapter` 工厂。两种方案：
1. **方案 A1（推荐）**：把 `apps/worker/src/models/*.ts` 提到新 package `packages/model-adapters`，worker 和 web 同时依赖。改动稍大但干净。
2. **方案 A2**：web 端在 `apps/web/src/server/model-adapters.ts` 复刻一份，与 worker 并存。短期省事，长期会漂移。

**决策点 B — 方法论选择是否同时落库为 `WritingMethodology` 记录** → **已确认采用 B2**

事实证据：
- `WritingMethodology.projectId` 是非空必填，`@@unique([projectId, name])`，表设计就是"一项目至少一行"。
- `apps/worker/src/pipeline/generate-chapter-handler.ts:174` 每次生成章节都调 `loadActiveMethodology(prisma, job.projectId)`。
- `apps/worker/src/pipeline/chapter-pipeline.ts:165-166` 将 `reviewCriteria` 作为 review pass 必查项，缺记录 → `methodology_violation` 检查链失效。

落库内容（创建项目事务内一次写入）：
- `organizationId / projectId / name`（取模板 `name`）
- `methodType`（向导选择值）
- `description`（模板 `description`）
- `outlineMetadata`（模板 `outlineMetadata` 序列化）
- `reviewCriteria`（模板 `reviewCriteria` 序列化）
- `isActive=true`

如果用户在 Step 2 选了"暂不选择"则不创建记录，worker 走"无方法论"分支（已支持）。

**决策点 C — 题材/风格多选拼接方式** → **已确认采用 C1**

事实证据：
- 当前查询路径 `apps/web/src/components/projects/project-list.tsx:34` 仅做字符串展示，**全仓库没有按 genre 筛选/聚合的查询**。
- 数据规模 < 千行时单字段 read/write 比 JSONB 反序列化更快。
- C2 的赢点是"按 tag 索引筛选"，当前没有这个需求。

落库约定：
- `projects.genre` 存逗号分隔串，例 `"奇幻,玄幻"`，前端 `split(",")` 解析。
- `projects.styleBrief` 同样存逗号分隔串。
- 在 `apps/web/src/server/projects.ts` 加注释说明该约定与未来迁移触发条件（"出现按题材聚合查询且单组织项目数超 1 万行时再迁 JSONB"）。

---

## 6. 决策汇总（2026-05-19 确认）

| 点 | 方案 | 影响 |
|----|------|------|
| A | A1：抽 `packages/model-adapters` | worker 和 web 共用，避免漂移 |
| B | B2：选了方法论即落库 `WritingMethodology` 一行 | 让 worker 现有 pipeline 实际生效 |
| C | C1：逗号分隔字符串 | 不动 schema，当前规模性能最优 |

进入 Phase A。

---

## 6. 验收标准

- [ ] 新人在 fake-model 模式下，3 分钟内能走完向导并进入工作台，看到 ≥3 个预填大纲条目。
- [ ] 设置页能看到"当前演示模式"横幅，能新增/编辑/删除 Provider 和 Profile，能"测试连接"返回 OK。
- [ ] 既有 Playwright smoke spec 仍然绿灯；扩展的 spec 也绿灯。
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm test:e2e` 全绿。
- [ ] `docs/current-progress.md` 更新本轮变更与下一步。
