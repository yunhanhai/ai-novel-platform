# AI 小说平台 — 拓展功能路线图

> 日期：2026-05-01  
> 类型：MVP 之后的拓展计划，不替代当前 MVP 执行计划  
> 状态：已结合公开资料、远程代码示例、当前仓库 schema/代码重新校准  
> 当前执行前置：先完成 `docs/plans/2026-04-30-windows-postgres-mvp-plan.md`

本文件回答三个问题：

1. **AI 写小说有哪些可借鉴方法？**
2. **这些方法结合当前项目是否可行？**
3. **当前拓展计划还可以如何优化，下一步应该按什么顺序做？**

结论先行：方向可行，但不能直接跳到“全自动多 Agent 写书”。当前项目已经具备 SaaS、PostgreSQL、Prisma、生成任务和步骤记录的底座；真正缺的是写作资产表、记忆系统、Worker、上下文组装器、模型适配器和质量审查闭环。拓展计划因此应从“资料/记忆真源”开始，再做“章节生成管线”，最后才升级到向量检索、知识图谱和复杂多 Agent。

---

## 0. 证据边界

### 0.1 已核实的本项目事实

来源：`README.md`、`docs/current-progress.md`、`docs/windows-local-development.md`、`docs/plans/2026-04-30-windows-postgres-mvp-plan.md`、`packages/db/prisma/schema.prisma`、`packages/shared/src/generation/state.ts`、`apps/web/src/app/page.tsx`。

- 当前仓库是 pnpm monorepo：`apps/*` + `packages/*`。
- 当前 Web App 是 Next.js 16 + React 19 的最小壳，尚未实现项目库、工作台、AI 面板、API 路由。
- 注意：`docs/current-progress.md` 和当前 MVP 计划仍把 App/API 层列为下一步；实际工作区已经出现 `apps/web` 最小壳。后续应单独同步进度文档和 MVP 任务状态，本路线图只记录当前代码事实。
- 当前数据库使用 PostgreSQL 16 + Prisma 7。
- 当前已落库的核心表包括：
  - 账号/组织：`users`、`user_identities`、`organizations`、`organization_members`、`invitations`
  - 作品结构：`projects`、`project_members`、`volumes`、`chapters`、`outlines`、`content_versions`
  - AI 配置：`model_providers`、`model_profiles`、`prompt_templates`
  - 任务与审计：`generation_jobs`、`generation_steps`、`usage_events`、`audit_logs`
- 当前已预留的 AI 任务类型包括：`generate_outline`、`generate_chapter`、`continue_chapter`、`rewrite`、`polish`、`deslop`、`review`、`extract_memory`。
- 当前 `packages/shared/src/generation/state.ts` 已实现生成任务状态机。
- 当前本地开发优先使用 PostgreSQL-backed jobs，Redis/BullMQ 是后续可选项。

### 0.2 当前尚未落地的关键能力

以下内容在设计文档或旧计划中出现过，但**当前 Prisma schema 与业务代码尚未实现**：

- `characters`
- `character_relationships`
- `world_items`
- `plot_threads`
- `project_memories`
- `style_profiles`
- `deslop_rules`
- `writing_methodologies`
- `generation_stream_events`
- `apps/worker`
- 模型调用适配器
- prompt builder
- context selector
- memory extractor
- review/deslop/revise pipeline

因此，本路线图将这些能力列为后续阶段，不再误判为“已有表扩展”。

### 0.3 外部资料证据

本次调研引用的可复核公开资料和远程代码示例包括：

- DOME：论文 *Generating Long-form Story Using Dynamic Hierarchical Outlining with Memory-Enhancement*，提出动态分层大纲、记忆增强、时间知识图谱和冲突分析器。  
  https://arxiv.org/abs/2412.13575
- SCORE：论文 *Story Coherence and Retrieval Enhancement for AI Narratives*，提出动态状态追踪、上下文感知摘要、TF-IDF + embedding 混合检索。  
  https://arxiv.org/html/2503.23512v1
- Sudowrite Story Bible：把 Braindump、Synopsis、Genre/Style、Characters、Worldbuilding、Outline、Scenes 作为互相递进的“活系统”。  
  https://sudowrite.com/blog/story-bible-template-how-to-build-one-and-how-sudowrite-does-it-for-you/
- Claude Code Book Bible：用角色文件、时间线、世界规则、剧情大纲作为写前一致性检查和写后更新的持久真源。  
  https://www.claudecodehq.com/playbooks/book-bible
- InkOS 远程代码示例：`story_bible.md`、`volume_outline.md`、`style_guide.md`、`current_state.md`、`pending_hooks.md` 等真相文件；远程代码搜索显示许可证为 AGPL-3.0，应只借鉴架构思路，不复制代码。  
  https://github.com/Narcooo/inkos
- DOME 代码仓库：使用 Neo4j 存储/访问知识图谱，适合作为后期图谱化参考。  
  https://github.com/Qianyue-Wang/Generating-Long-form-Story-Using-Dynamic-Hierarchical-Outlining-with-Memory-Enhancement
- RisuAI 远程代码示例：Lorebook/世界书通过激活关键词和插入顺序决定是否注入上下文，适合作为轻量上下文召回参考。  
  https://github.com/kwaroran/Risuai
- PlotPilot 远程代码示例：`chapter_summaries` 包含 `key_events`、`open_threads`、`consistency_note`、`beat_sections`、`micro_beats`、`sync_status`，适合借鉴章节摘要结构。
- SillyTavern World Info / Lorebook：成熟的关键词、递归激活、token budget、角色/人格/聊天绑定记忆机制，适合作为世界书动态注入参考。  
  https://github.com/SillyTavern/SillyTavern
- SillyTavern-MemoryBooks：把场景范围交给 AI 总结，再写回 lorebook entry，适合作为“章节后记忆沉淀”的产品模式参考。  
  https://github.com/aikohanasaki/SillyTavern-MemoryBooks
- Claude-Book：使用 planner/writer/style-linter/character-reviewer/continuity-reviewer/state-updater 闸门，并把 `bible/` 与 `state/` 分层，适合作为章节质量 gate 参考。  
  https://github.com/ThomasHoussin/Claude-Book
- LangChain story-writing：章节版本图和 first/rewrite/continue 路由适合借鉴，但该仓库已归档，只作为状态设计参考。  
  https://github.com/langchain-ai/story-writing
- NousResearch autonovel：从 seed 到 foundation、drafting、revision、export 的成书管线，包含独立 judge、阈值、评估日志、导出资产，适合作为远期出版资产 pipeline 参考。  
  https://github.com/NousResearch/autonovel

许可证硬约束：所有外部仓库在未逐一核验 LICENSE 前，只能借鉴产品/架构模式，不复制代码、prompt、schema、配置或文档文本；AGPL/GPL 项目尤其不得混入本仓库实现。

---

## 1. AI 写小说的核心可借鉴方法

### 1.1 直接让 AI 写正文效果最不稳定

公开资料和开源项目基本一致：直接输入“写一章小说”会快速暴露以下问题：

- 角色性格漂移
- 世界规则冲突
- 伏笔忘记回收
- 时间线错乱
- AI 高频套话和空泛总结
- 情节只推进当前段落，缺少中长期目标

所以可借鉴的主流思路不是“更长 prompt”，而是“把创作过程拆成可验证的资产和步骤”。

### 1.2 故事圣经/世界书是最高杠杆

Sudowrite、Book Bible、InkOS、RisuAI 等资料都指向同一个原则：

> AI 的记忆不应该依赖聊天上下文，而应该来自可维护的项目真源。

本平台应把这些真源拆成结构化资产：

- 作品定位：题材、受众、平台、核心卖点、禁忌
- 故事梗概：全书核心矛盾、阶段目标、终局方向
- 风格指南：句式、节奏、对白比例、禁用表达
- 角色卡：动机、性格、说话方式、关系、知识边界、弧光
- 世界观：地点、势力、规则、道具、等级体系
- 时间线：事件顺序、因果、角色所在地
- 伏笔板：埋设、推进、延迟、回收、放弃
- 章节摘要：每章发生了什么、谁改变了、哪些线索被推进

### 1.3 分层大纲优于一次性大纲

DOME 和商业写作工具都强调分层规划：

```text
一句话卖点
→ 全书梗概
→ 四幕/三幕/卷级结构
→ 章节级目标
→ 场景/节拍
→ 正文
```

本项目已有 `outlines.level = book | volume | chapter | beat`，这正好适配分层大纲。后续不需要另起一套大纲系统，而应扩展 `outlines.metadata` 或新增方法论模板来记录：

- 爽点/情绪目标
- 角色目标
- 冲突类型
- 伏笔 agenda
- 场景节拍
- 预期字数
- 结尾钩子

### 1.4 写前检索 + 写后抽取是长篇连续性的关键

SCORE 的三个组件对产品化很有启发：

1. Dynamic State Tracking：追踪角色/物品/状态变化。
2. Context-Aware Summarization：分层章节摘要，保留时间进展和情绪变化。
3. Hybrid Retrieval：关键词检索 + 语义检索混合召回。

对应到本平台：

```text
写前：根据当前章目标检索角色、世界规则、前文摘要、伏笔、禁忌
生成：plan → draft → review → revise
写后：抽取新事实、状态变化、伏笔变化、章节摘要
确认：用户审核后写入项目真源
```

### 1.5 多 Agent 不等于一开始就上 10 个 Agent

InkOS 的多 Agent 设计值得借鉴，但当前项目不应一开始复制复杂 10 Agent 管线。更合适的产品化路径是：

```text
MVP 质量管线：plan → draft → review → revise
稳定后扩展：memory_extract → deslop → continuity_audit
再之后：planner/composer/writer/auditor/reviser 等角色细分
```

当前已有 `generation_steps`，适合记录这些步骤的审计摘要。当前 schema 中 `GenerationStep` 只有 `stepKey/status/modelProfileId/promptSnapshot/inputTokens/outputTokens/latencyMs/outputPreview/errorMessage` 和时间字段；第一版完整输入放 `GenerationJob.input`，完整结构化结果放 `GenerationJob.output`，步骤表只保存 prompt 快照、输出预览、token、耗时和错误摘要。若未来要逐步重放每一步，再新增步骤级 JSON 输入/输出字段。

### 1.6 “去 AI 味”应先做规则 + 统计，再做 LLM 改写

去 AI 味不是简单让模型“写得更自然”。更稳的做法是：

1. 规则扫描：禁用词、弱化副词、套话、排比三连、过度总结。
2. 频率统计：同一词/句式在单章和多章中的重复。
3. 风格指纹：句长、对白比例、描写密度、动词密度。
4. LLM 改写：只对高风险片段给出替换建议。
5. 用户确认：不自动覆盖定稿，只生成版本和建议。

这与当前 `deslop` job type、`prompt_templates`、`content_versions` 完全兼容。

### 1.7 世界书激活可以先用关键词，不必先上向量库

RisuAI 的 Lorebook/世界书思路说明：只有当前上下文命中关键词时才注入相关 lore，且可以通过插入顺序控制优先级。

SillyTavern 的 World Info 进一步说明，世界书不是静态资料库，而是动态 prompt 注入引擎：它需要激活条件、递归激活、预算控制、角色/会话绑定和激活事件记录。对小说平台而言，这比“把所有设定塞进 prompt”更安全。

这对本项目非常实用：

- 第一阶段用 PostgreSQL + 关键词/别名匹配即可。
- 每次生成都记录 lore activation report，让用户看到“本章 AI 读了哪些角色/地点/道具/伏笔”。
- 后续再补全文索引、pg_trgm、pgvector、Qdrant 或 Neo4j。
- 不要为了“高级记忆”过早引入多套基础设施。

### 1.8 章节版本树适合小说创作

LangChain story-writing 的 first/rewrite/continue 路由和章节版本图说明：小说创作不应只有覆盖式保存。更适合的模型是：

```text
chapter version A
├─ rewrite candidate A1
├─ rewrite candidate A2
└─ continue branch B
```

当前项目已有 `content_versions`，第一版不需要新增版本树表，也可以用 `entityType/entityId/versionNo/source/generationJobId` 支撑候选版本；后续如果要支持显式分支，再增加 `parentVersionId`。

### 1.9 审稿模型应与写作模型分离

autonovel 的 writer/judge 分离思路值得借鉴：同一个模型写稿再自评，容易自我恭维。产品上应允许：

- Writer model：偏创作、长上下文、成本可控。
- Judge model：偏严格审稿、一致性检查、低温度。
- Reviewer criteria：由题材、风格、伏笔和角色卡生成。

当前 `model_profiles.taskType` 已适合承载这种模型分工。

---

## 2. 当前项目可行性评估

### 2.1 总体评分

| 维度 | 评分 | 判断 |
|------|------|------|
| 技术栈匹配度 | 90/100 | Next.js + TypeScript + Prisma + PostgreSQL 适合 SaaS 型写作平台 |
| 数据底座 | 75/100 | 已有作品/章节/大纲/版本/任务表，但缺角色、世界观、伏笔、记忆表 |
| 生成任务底座 | 80/100 | `generation_jobs` + `generation_steps` + 状态机可支撑管线，但 Worker 未实现 |
| 长篇连续性 | 45/100 | 当前缺记忆表、上下文选择器、写后抽取，不能可靠支撑长篇 |
| 去 AI 味能力 | 50/100 | 已有 `deslop` 任务类型和版本表，缺规则表、扫描器和 UI |
| 多 Agent 能力 | 55/100 | `generation_steps` 可记录步骤，但缺编排器、模型适配器、重试/审计循环 |
| Windows 本地可运行性 | 85/100 | PostgreSQL 原生方案合理；不宜过早依赖 Redis/Milvus/Neo4j |

综合判断：**可行，但应按依赖顺序推进。当前最优策略是“PostgreSQL 内完成第一版写作资产和管线闭环”，而不是立即引入图数据库/向量库/复杂 Agent。**

### 2.2 当前可直接复用的项目能力

- `projects.styleBrief`：可作为第一版风格输入。
- `outlines`：可作为分层大纲和 beat 管理基础。
- `chapters`：可作为正文和章节状态基础。
- `content_versions`：可保存 AI 草稿、改写、去 AI 味版本，避免覆盖用户内容。
- `prompt_templates`：可保存 plan/draft/review/revise/deslop/extract_memory 模板。
- `model_profiles.taskType`：可让不同任务使用不同模型和参数。
- `generation_jobs.jobType`：已预留生成、续写、重写、润色、去 AI 味、审稿、记忆抽取。
- `generation_steps`：可记录多步骤管线。
- `usage_events`：可支撑 token/成本可见。
- `audit_logs`：可记录敏感操作和管理员访问。

### 2.3 当前必须补齐的能力

必须在高级 AI 写作功能之前补齐：

1. `apps/worker`：没有 Worker 就没有异步管线。
2. generation job repository：没有 claim/lease/retry 就无法安全执行任务。
3. fake chapter pipeline：先用 fake model 验证任务、版本、步骤、用量闭环。
4. 角色/世界观/伏笔/记忆表：没有写作资产就没有可靠上下文。
5. context selector：没有上下文选择就无法控制 token 和一致性。
6. prompt builder：没有模板变量校验就容易输出不可控。
7. model adapter：没有统一适配器就会让业务代码绑定具体供应商。
8. structured output validator：所有结构化输出必须校验，不能信任模型 JSON。

---

## 3. 优化后的拓展路线

### Phase A：先完成当前 MVP，不并线抢跑

**目标：让平台能创建作品、章节、排队 fake 生成任务、Worker 处理任务并保存版本。**

继续执行：`docs/plans/2026-04-30-windows-postgres-mvp-plan.md`

至少完成以下任务后，再开始设计本路线图中的后端/Worker 类拓展：

1. App Shell 与 env loader。
2. Password utilities / auth 基础能力。
3. Auth / organization / project / chapter / outline services。
4. PostgreSQL-backed generation job repository。
5. Worker skeleton。
6. Model provider service。
7. Fake chapter generation pipeline。

面向用户可操作的拓展功能，还需要继续完成项目库页面和最小写作工作台（当前 MVP 计划 Task 11-12）。因此本路线图拆成两层门槛：

- **Task 10 后**：可以开始写作资产 schema、Context Packet Builder、fake 多步骤管线的设计和底层实现。
- **Task 12 后**：再交付用户可见的故事资产管理、AI 面板、去 AI 味报告和工作台交互。

**验收门槛：**

```bash
pnpm db:validate
pnpm db:generate
pnpm test
pnpm typecheck
```

必须全部通过。

---

### Phase B：写作资产真源

**目标：把故事圣经/世界书从“文档理念”变成数据库真源。**

#### B1. 新增角色表

建议表：`characters`

核心字段：

- `organization_id`
- `project_id`
- `name`
- `aliases jsonb`
- `role_type`
- `appearance`
- `personality`
- `motivation`
- `speech_pattern`
- `knowledge_boundary jsonb`
- `arc`
- `constraints`
- `status`
- `metadata jsonb`

说明：`knowledge_boundary` 比单纯人物卡更重要，用来记录“此角色知道什么/不知道什么”，防止信息越界。

约束建议：`organization_id`、`project_id` 外键；`(project_id, name)` 唯一或软唯一；按 `(organization_id, project_id, status)` 建索引；保留 `deleted_at` 软删除，避免历史版本和记忆引用断裂。

#### B2. 新增角色关系表

建议表：`character_relationships`

核心字段：

- `source_character_id`
- `target_character_id`
- `relation_type`
- `strength`
- `status`
- `is_hidden`
- `evidence jsonb`
- `changed_at_chapter_id`

说明：关系不是静态描述，必须允许状态变化和证据来源。

约束建议：`organization_id`、`project_id` 外键；`source_character_id`、`target_character_id` 指向 `characters`；`(project_id, source_character_id, target_character_id, relation_type)` 唯一；按 `(project_id, status)` 建索引。

#### B3. 新增世界观条目表

建议表：`world_items`

核心字段：

- `item_type`: `location | faction | artifact | rule | power_system | timeline_event`
- `name`
- `aliases jsonb`
- `summary`
- `detail`
- `constraints`
- `activation_keywords jsonb`
- `priority`
- `metadata jsonb`

说明：`activation_keywords` 支撑第一版世界书关键词召回。

约束建议：`organization_id`、`project_id` 外键；`(project_id, item_type, name)` 唯一或软唯一；按 `(project_id, item_type)` 和 `(project_id, priority)` 建索引；关键词命中由服务层处理。

#### B4. 新增伏笔/线索表

建议表：`plot_threads`

核心字段：

- `thread_type`: `main | side | foreshadowing | mystery | conflict`
- `status`: `planted | progressing | deferred | resolved | abandoned`
- `planted_chapter_id`
- `expected_payoff_chapter_id`
- `resolved_chapter_id`
- `cooldown_until_chapter_no`
- `priority`
- `dependencies jsonb`
- `evidence jsonb`

说明：第一版不要做复杂 DAG 表；用 `dependencies jsonb` 足够，后续再拆边表。

约束建议：`organization_id`、`project_id` 外键；章节关联字段指向 `chapters`；按 `(project_id, status, priority)` 和 `(project_id, expected_payoff_chapter_id)` 建索引；`dependencies jsonb` 第一版由服务层校验，后续再迁移成边表。

#### B5. 新增项目记忆表

建议表：`project_memories`

核心字段：

- `memory_type`: `chapter_summary | volume_summary | character_state | world_fact | hook_status | style_note | continuity_note`
- `scope_type`: `project | volume | chapter | character | world_item | plot_thread`
- `scope_id`
- `content text`
- `content_json jsonb`
- `source_chapter_id`
- `source_job_id`
- `confidence`
- `status`: `proposed | accepted | rejected | superseded`

说明：写后抽取不要直接污染真源，先生成 `proposed`，由用户确认后生效。

约束建议：`organization_id`、`project_id` 外键；`source_chapter_id` 指向 `chapters`、`source_job_id` 指向 `generation_jobs`；按 `(project_id, memory_type, scope_type, scope_id)` 和 `(project_id, status, created_at)` 建索引。`scope_type + scope_id` 是多态引用，无法由数据库完整外键约束，必须由服务层校验目标对象存在且同属一个组织/作品。

**Phase B 验收：**

- 能创建/读取/更新角色、世界观、伏笔和记忆。
- 所有表都有 `organization_id` 并通过租户 helper 访问。
- 章节写作前能查询项目相关资产。
- 写后抽取结果可以作为提案保存，不自动覆盖人工确认内容。

---

### Phase C：上下文选择与故事圣经组装

**目标：把写作资产组装成可控、可解释、可复现的 context packet。**

建议新增模块：

```text
apps/worker/src/context/select-context.ts
apps/worker/src/context/build-context-packet.ts
apps/worker/src/context/token-budget.ts
apps/worker/src/context/keyword-activation.ts
```

第一版 context packet：

```text
1. 作品定位和风格摘要
2. 当前章 outline / beat
3. 相关角色卡和状态
4. 相关世界规则/地点/道具
5. 最近 1-3 章摘要
6. 当前卷摘要
7. open/progressing 伏笔
8. 禁用事项和去 AI 味规则
```

每次 context packet 还应生成 `activationReport`：列出命中的角色、世界观条目、伏笔、章节摘要、触发关键词、优先级和被 token budget 裁剪掉的条目。这个报告是后续 UI 中 “Memory/Lore Inspector” 的数据源。

优先使用确定性规则：

- 当前章 outline 指定角色 → 注入对应角色。
- 当前章 outline/最近正文命中 `activation_keywords` → 注入世界观条目。
- 当前章节号接近 `expected_payoff_chapter_id` → 注入伏笔。
- 最近 1-3 章摘要永远注入。
- 超预算时按优先级裁剪，而不是随机截断。

后续再加入：

- PostgreSQL full text search
- `pg_trgm`
- `pgvector`
- Qdrant
- Neo4j

**Phase C 验收：**

- 同一输入生成的 context packet 可复现。
- `activationReport` 可解释本次生成激活了哪些 lore / memory。
- packet 摘要记录到 `generation_steps.prompt_snapshot`；完整输入仍放在 `generation_jobs.input`，避免当前 schema 中不存在的步骤级 `input/output` 字段。
- 单元测试覆盖 token 预算、关键词激活和优先级裁剪。

---

### Phase D：四步章节生成管线

**目标：从单次生成升级为可审计的最小多步骤管线。**

建议 job type：继续使用 `generate_chapter`，通过 `generation_steps.stepKey` 表达步骤。

步骤：

```text
plan
draft
review
revise
persist_version
extract_memory
```

#### D1. plan

输入：context packet + 当前章目标。  
输出：本章写作计划。

建议结构：

```json
{
  "chapterGoal": "",
  "sceneBeats": [],
  "charactersInScene": [],
  "mustIncludeFacts": [],
  "hookAgenda": [],
  "forbiddenMoves": []
}
```

#### D2. draft

输入：plan + context packet + 风格指南。  
输出：正文初稿。

#### D3. review

输入：draft + context packet。  
检查项：

- 人设一致性
- 世界规则冲突
- 伏笔推进/误回收
- 时间线错误
- 信息边界越界
- AI 味
- 节奏/爽点缺失

#### D4. revise

输入：draft + review issues。  
输出：修订稿和修订说明。

#### D5. persist_version

输出写入 `content_versions`，不直接覆盖用户定稿。

#### D6. extract_memory

输出：`project_memories(status=proposed)` + 可能的角色/伏笔/世界观更新提案。

借鉴 MemoryBooks 的场景范围思想，抽取时必须记录来源范围：章节、版本、段落/场景范围、触发 job、抽取 prompt 版本。这样用户拒绝或回滚一段正文时，可以定位并撤销对应记忆提案。

**Phase D 验收：**

- 每个 step 都有 `generation_steps` 记录。
- fake model 测试覆盖全流程。
- review 失败不会吞错，会形成可见问题。
- revise 最多循环 2 次，避免无限任务。
- 记忆提案包含可追溯来源范围，且默认不进入 accepted 真源。

---

### Phase E：去 AI 味引擎

**目标：把“去 AI 味”从 prompt 口号变成规则、统计、建议和版本。**

#### E1. 新增规则表

建议表：`deslop_rules`

字段：

- `organization_id`
- `project_id`
- `rule_type`: `exact_match | regex | frequency | sentence_pattern`
- `pattern`
- `category`
- `severity`: `info | warning | error`
- `suggestion`
- `genre`
- `is_active`

#### E2. 第一版扫描器

先实现确定性扫描：

- 高频弱化副词
- 过度总结句
- 抽象名词三连
- 固定套话
- 同章重复词
- 连续段落相似句式

#### E3. LLM 改写建议

LLM 不直接覆盖正文，只输出：

- 问题片段
- 问题类型
- 建议替换
- 保守/激进两种修改方案

**Phase E 验收：**

- `deslop` job 能生成结构化报告。
- 用户可选择应用建议并生成新 `content_versions`。
- 测试不调用真实模型，使用 fake model。

---

### Phase F：风格画像与写法模板

**目标：把文风和写作方法论沉淀为可复用资产。**

#### F1. 风格画像

建议表：`style_profiles`

字段：

- `name`
- `reference_texts jsonb`
- `style_brief`
- `sentence_length_profile jsonb`
- `dialogue_ratio`
- `description_density`
- `banned_words jsonb`
- `preferred_words jsonb`
- `rhythm_notes`
- `is_active`

先实现统计能力：

- 平均句长
- 对白比例
- 高频词
- 段落长度分布
- 动词/形容词密度

再补 LLM 风格总结。

#### F2. 写作方法论模板

建议表：`writing_methodologies`

模板类型：

- 雪花写作法
- 三幕式
- 四幕式
- 起点/番茄男频爽文节奏
- 晋江感情线节奏
- 短篇反转故事

说明：方法论不应成为强制流程，而应影响 outline metadata、prompt template 和 review criteria。

---

### Phase G：高级记忆与图谱化

**目标：当 PostgreSQL 规则检索不够用时，再引入更复杂的检索/图谱层。**

推荐顺序：

1. PostgreSQL 关键词 + JSONB。
2. PostgreSQL full text search。
3. `pg_trgm` 模糊匹配。
4. `pgvector` 或 Qdrant 做语义检索。
5. Neo4j 或图数据库做复杂关系/时间冲突分析。

说明：`pg_trgm`、`pgvector` 都属于后期迁移项；即使继续使用 Windows 原生 PostgreSQL，也必须先确认扩展可安装、可迁移、可备份，不能默认本地环境已经具备。

不建议 MVP 阶段直接引入 Neo4j/Qdrant/Milvus，原因：

- Windows 本地复杂度明显增加。
- 当前项目还没有基础 Worker 和资产服务。
- 第一版一致性问题大多可用结构化表 + 关键词 + 摘要解决。

---

## 4. 与当前 MVP 计划的衔接

| 当前 MVP 任务 | 与本路线图关系 | 说明 |
|---------------|----------------|------|
| Task 1 Web App Skeleton | 前置 | 后续工作台 UI 依赖 |
| Task 2 Env Loader | 前置 | Worker/模型配置依赖 env |
| Task 3 Password Utilities | 前置 | Auth 服务和用户发起生成任务依赖 |
| Task 4 User/Organization Services | 前置 | 所有写作资产必须租户隔离 |
| Task 5 Project Service | 前置 | 写作资产归属 project |
| Task 6 Chapter/Outline Services | 前置 | context packet 依赖章节和大纲 |
| Task 7 Generation Job Repository | 强前置 | 所有 AI 管线都依赖任务 claim/lease |
| Task 8 Worker Skeleton | 强前置 | 多步骤管线必须在 Worker 中跑 |
| Task 9 Model Provider Service | 强前置 | 真实 LLM 调用和模型切换依赖 |
| Task 10 Fake Chapter Pipeline | 强前置 | 先验证端到端闭环，再接真实模型 |
| Task 11 Project Library Pages | 用户可见前置 | 用户需要入口管理作品 |
| Task 12 Minimal Workspace | 前置 | 用户需要可视化发起任务和查看版本 |

---

## 5. 优先级总表

| 优先级 | 模块 | 为什么 | 当前可行性 | 前置依赖 |
|--------|------|--------|------------|----------|
| P0 | 完成当前 MVP | 没有 Worker/服务层就无法验证 AI 功能 | 高 | 无 |
| P1 | 写作资产真源 | 长篇连续性的基础 | 高 | Project/Chapter services |
| P1 | 项目记忆表与章节摘要 | 写前上下文和写后抽取基础 | 高 | Worker + schema migration |
| P1 | Context Packet | 控 token、控一致性 | 高 | 写作资产表 |
| P1 | 四步生成管线 | 最小多 Agent 质量闭环 | 中高 | Job repository + Worker |
| P2 | 去 AI 味规则引擎 | 用户痛点强，可独立交付 | 高 | deslop_rules + content_versions |
| P2 | 伏笔/追读管理 | 网文差异化 | 中高 | plot_threads + review criteria |
| P2 | 风格画像 | 提升平台粘性 | 中 | style_profiles + prompt templates |
| P3 | 写作方法论模板 | 锦上添花 | 中 | outline metadata |
| P3 | 向量检索/知识图谱 | 高级连续性 | 中低 | 数据量和真实使用场景 |

---

## 6. 优化后的最小可交付切片

### Slice 1：故事资产 CRUD

交付：角色、世界观、伏笔、项目记忆基础 CRUD。

成功标准：

- 用户能为作品维护角色卡、世界观和伏笔。
- 所有查询按 `organization_id` 隔离。
- 所有资产可被后续 context selector 读取。

### Slice 2：Context Packet Builder

交付：确定性上下文组装器。

成功标准：

- 输入 `projectId + chapterId + jobType`，输出可解释 context packet。
- 支持关键词激活世界观。
- 支持 token 预算裁剪。
- 有单元测试覆盖。

### Slice 3：Fake Multi-Step Chapter Pipeline

交付：用 fake model 跑通 `plan → draft → review → revise → persist_version → extract_memory`。

成功标准：

- 所有步骤写入 `generation_steps`。
- 生成结果写入 `content_versions`。
- 抽取结果写入 `project_memories(status=proposed)`。
- 不调用真实 LLM。

### Slice 4：真实模型适配器

交付：统一 `ModelAdapter` 接口 + OpenAI-compatible 第一版。

成功标准：

- 自动化测试仍使用 fake model。
- 真实调用只在手动/集成环境运行。
- 错误映射清晰：鉴权失败、额度不足、超时、内容策略、解析失败。

说明：当前 `generation_jobs` 已有 `status`、`lockKey`、`leaseExpiresAt`，足够支持 claim/lease/fail 可见；严格 retry/backoff 还需要后续补 `attemptCount`、`maxAttempts`、`nextRunAt` 等字段，不能在第一版里隐含承诺。

### Slice 5：去 AI 味报告

交付：规则扫描 + LLM 建议 + 版本保存。

成功标准：

- 用户能看到高风险词句。
- 能生成建议替换。
- 应用建议后创建新版本，不覆盖原文。

### Slice 6：章节版本树与候选稿选择

交付：在 `content_versions` 之上支持候选稿选择和 rewrite/continue 分流。

成功标准：

- 同一章节可保存多个 AI 候选版本。
- 用户可选择某个版本作为当前正文基线。
- rewrite 生成新版本，不覆盖旧版本。
- continue 只基于用户选定的当前版本继续。

---

## 7. 架构审查

### 7.1 现象层：当前路线图已修正的问题

1. **过早复杂化**  
   原路线图容易让人直接上 Neo4j/Qdrant/10 Agent。已优化为 PostgreSQL 内先闭环。

2. **当前状态误判**  
   原路线图部分段落将 `characters`、`world_items`、`plot_threads`、`project_memories` 当作当前已有或可直接扩展。已修正为“后续新增”。

3. **缺少执行门槛**  
   原路线图没有明确与当前 MVP 任务的前置关系。已补充衔接表和 Slice。

4. **缺少用户确认环节**  
   写后记忆抽取如果直接写真源会污染设定。已改为 `proposed → accepted/rejected`。

5. **缺少确定性优先原则**  
   原路线图偏重 LLM/Agent。已补充规则扫描、关键词召回、token 预算和可复现 context packet。

### 7.2 本质层：架构诊断

问题本质：当前项目的基础设施是 SaaS + 数据库 + 任务系统，AI 写小说所需的是“内容资产编排系统”。

根本原因：长篇写作质量不是模型单点能力，而是资产真源、上下文召回、生成步骤、审查反馈和写后更新共同作用。

系统影响：如果跳过资产真源和 context packet，后续任何多 Agent 都会变成不可复现的 prompt 堆叠，测试困难、成本不可控、一致性不可控。

重构路径：

```text
先补写作资产表
→ 再做 context packet
→ 再做 fake 多步骤管线
→ 再接真实模型
→ 再做高级检索/图谱
```

### 7.3 哲学层：设计原则

- **好品味**：把特殊情况变成结构化状态，而不是在 prompt 中不断补丁。
- **KISS**：第一版用 PostgreSQL、关键词和 JSONB，不提前引入 Neo4j/Qdrant。
- **DRY**：所有 AI 动作复用 `generation_jobs`、`generation_steps`、`prompt_templates`、`model_profiles`。
- **YAGNI**：不做全自动批量写整本，不做复杂社区，不做版权交易。
- **可回滚**：所有 AI 输出先生成 `content_versions`，不覆盖用户定稿。
- **可验证**：所有结构化输出必须校验；自动化测试使用 fake model。

### 7.4 风险清单

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 模型输出 JSON 不稳定 | 高 | schema validator + repair step + fake model tests |
| 长篇上下文 token 爆炸 | 高 | context packet + token budget + 优先级裁剪 |
| 写后抽取污染设定 | 高 | proposed 状态，用户确认后生效 |
| 并发生成污染章节 | 高 | 沿用 `chapters.lockedByJobId` 和 `generation_jobs.lockKey` |
| API Key 泄露 | 高 | 加密存储，不进日志，不进 prompt snapshot |
| 过早引入多基础设施 | 中 | PostgreSQL-first，按数据规模再引入检索/图谱 |
| 许可证风险 | 中 | AGPL/GPL 项目只借鉴设计，不复制代码 |
| AI 味规则误伤文风 | 中 | warning 优先，用户确认，不自动替换 |
| 写作模型自评过宽 | 中 | writer/judge 分离，review 使用独立模型配置和低温度 |

### 7.5 审查结论

综合评分：**86/100，可推进，但必须按依赖分期执行。**

通过条件：

- 先完成当前 Windows PostgreSQL MVP。
- 第一批拓展只做 PostgreSQL 内可交付能力。
- 所有 AI 输出版本化、可回滚、可审计。
- 所有结构化输出有校验和测试。

不建议立即做：

- 全自动整本书批量生成。
- 10 Agent 完整复制。
- Neo4j/Qdrant/Milvus 强依赖。
- 未经确认的自动写后更新。
- 真实 LLM 调用进入自动化测试。

---

## 8. 推荐下一步

### 8.1 工程执行顺序

1. 继续执行 `2026-04-30-windows-postgres-mvp-plan.md` 到 Task 10，打通后端/Worker/fake pipeline 闭环。
2. 若目标是用户可见功能，继续完成 Task 11-12，打通项目库和最小写作工作台。
3. 新建“写作资产 schema”计划：`characters`、`world_items`、`plot_threads`、`project_memories`。
4. 新建“Context Packet Builder”计划。
5. 新建“Fake Multi-Step Chapter Pipeline”计划。
6. 再接真实模型适配器。

### 8.2 文档更新建议

- `docs/current-progress.md` 在完成 MVP Task 10 后更新一次。
- 后续每个拓展 Slice 单独建计划，不把所有功能塞进一个超大 PR。
- 若生成正式实施计划，建议拆为：
  - `writing-assets-schema-plan.md`
  - `context-packet-plan.md`
  - `multi-step-generation-pipeline-plan.md`
  - `deslop-engine-plan.md`

### 8.3 质量门禁

每个 Slice 完成前至少运行：

```bash
pnpm db:validate
pnpm db:generate
pnpm test
pnpm typecheck
```

涉及 Web UI 时再运行：

```bash
pnpm --filter @ai-novel/web build
```
