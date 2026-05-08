# Phase G 准备：高级记忆与图谱化可行性验证

> 日期：2026-05-01
> 类型：可行性验证清单 + 触发条件，不立即引入依赖
> 前置：Phase A→F 已闭环（PostgreSQL 内的写作资产 + 上下文召回 + 多步管线 + 风格画像/方法论）

本文件不修改 schema、不引入运行时依赖、不安装数据库扩展。只回答三个问题：

1. Phase G 在路线图中的边界是什么？
2. 引入更复杂检索/图谱前必须验证的事项有哪些？
3. 当前阶段"已经可以做"和"必须等"的事项分别是什么？

---

## 1. Phase G 边界

### 1.1 Phase G 不做的事

- 不在 Windows 本地默认安装 Neo4j 或 Qdrant。
- 不让 Phase A→F 现有功能依赖 pgvector/pg_trgm。
- 不让自动化测试调用真实嵌入模型或图谱数据库。
- 不在没有真实使用规模数据的情况下提前迁移。

### 1.2 Phase G 做的事（按依赖顺序）

| 阶段 | 内容 | 触发条件 |
|------|------|----------|
| G.0 | 全文检索：PostgreSQL `tsvector` + `to_tsquery` | 关键词召回开始误判（同义词、模糊匹配）|
| G.1 | 模糊匹配：`pg_trgm` 扩展 | 角色名/世界观条目存在大量别名 |
| G.2 | 语义检索：`pgvector` 扩展 + 嵌入向量 | 章节摘要/记忆超过 1000 条且关键词召回不够 |
| G.3 | 备选向量库：Qdrant 独立服务 | pgvector 无法承载读写并发或运维不便 |
| G.4 | 知识图谱：Neo4j 或 Memgraph | 出现复杂时间线冲突分析、跨章节因果追溯 |

> 顺序原则：**能在 PostgreSQL 内解决的不引入新基础设施**。

---

## 2. 引入前必须验证的事项

### 2.1 pgvector 在 Windows 原生 PostgreSQL 上的可行性

```
□ Windows PostgreSQL 16 二进制是否带 pgvector 包？
   验证命令：psql -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"
□ 如不带，是否能从 https://github.com/pgvector/pgvector 编译/安装到 Windows？
□ pgvector 数据是否能跟随 pg_dump 备份？
□ Prisma 7 是否支持 pgvector 类型？
   验证：检查 Prisma 是否生成 vector 列的 TypeScript 类型，或使用 Unsupported("vector(N)")
□ 是否能在不重启数据库的情况下创建/删除索引？
□ 索引重建对 8GB 内存机器的内存压力是否可控？
```

### 2.2 嵌入模型的成本与依赖

```
□ 嵌入维度：384 / 768 / 1536 / 3072 哪个适合？
   推荐：先用 384 或 768，平衡召回与成本
□ 嵌入模型来源：
   - 平台 key（OpenAI text-embedding-3-small）：成本可控，外部依赖
   - 本地模型（bge-small-zh-v1.5）：零成本，需要 Python/ONNX 推理服务
   - BYOK：用户自带 key
□ 嵌入失败/超时的兜底策略是什么？
   推荐：嵌入只是召回的 *增强*，失败时退回关键词召回，不阻塞生成
```

### 2.3 数据迁移与回滚

```
□ 现有 project_memories / characters / world_items 是否需要回填 embedding？
□ 回填任务是否可分批进行？是否可中断恢复？
□ 引入 vector 列后，旧版本代码是否仍能正常读写？（向后兼容）
□ 如果 pgvector 索引损坏，是否有重建脚本？
```

### 2.4 Neo4j / 图谱化的真实必要性

下列**所有**条件成立才考虑引入图数据库：

```
□ 已有至少 50 个角色和 100 条角色关系
□ 已出现 PostgreSQL 表结构难以表达的查询（多跳关系、时间因果链）
□ 团队有运维独立服务的能力（Windows 上 Neo4j 复杂度显著高于 PostgreSQL）
□ 现有 character_relationships + plot_threads.dependencies 已无法满足
```

---

## 3. 当前阶段可以做的"准备工作"

不破坏现有架构、不引入依赖的前提下，以下事项**已经可以做**：

### 3.1 schema 留出扩展点（不立即写入）

- `project_memories.metadata` 已是 jsonb，未来可存 embedding 摘要 hash
- `world_items.activation_keywords` 已是 jsonb 数组，未来可加 `synonyms` 字段
- `characters.knowledge_boundary` 已是 jsonb，未来可加 `vector_id` 引用

> **不需要**在当前阶段加任何 vector 列；等到 G.2 触发时再做。

### 3.2 索引召回报告留接口

`buildContextPacket` 的 `activationReport` 已经记录命中来源、关键词、优先级。**未来 pgvector 接入时，只需在 ActivationReport 增加 `semanticMatches` 字段，不破坏现有 contract**。

### 3.3 抽象 retrieval 层（可选轻量重构）

当前 `apps/worker/src/context/keyword-activation.ts` 是直接在内存中匹配。引入 G.0 全文检索时建议先做一次轻量重构：

- 把 "如何召回" 抽象成 `Retriever` 接口（findByKeyword、findBySemantic）
- 实现：`KeywordRetriever`（当前）、`FullTextRetriever`（G.0）、`VectorRetriever`（G.2）
- buildContextPacket 不感知具体实现

> 这一步可在 Phase G 触发前预先做，不依赖外部基础设施。

### 3.4 评估指标先行

引入复杂检索前必须先有评估方式。建议：

- 在 Phase D 的 `generation_steps.outputPreview` 中保留 `activationReport` 摘要
- 跑 100 章后人工抽查：召回的角色/世界观条目是否真的与生成内容相关？
- 形成召回质量基线，**有了基线才能判断 pgvector 是否真的提升了召回**

---

## 4. 不该做的事的明确清单

```
× 现在就给所有表加 embedding vector(768) 列
× 现在就引入 OpenAI 嵌入 API 调用（成本不可控且非必要）
× 现在就把 Neo4j 加入 docker-compose.yml
× 现在就让 keyword-activation 依赖 pg_trgm
× 现在就把章节摘要批量入库到向量库
× 现在就用图谱替换 character_relationships 关系表
```

每一条的理由都是同一个：**没有真实使用规模数据，无法评估效果，提前引入会增加 Windows 本地运维复杂度并阻塞主路径开发**。

---

## 5. Phase G 触发条件（任一满足即重新评估）

| 触发指标 | 阈值 | 行动 |
|---------|------|------|
| 单作品章节数 | > 200 | 启动 G.0 全文检索可行性验证 |
| 单作品角色数 | > 50 | 启动 G.1 pg_trgm 别名匹配验证 |
| 单作品 project_memories 数 | > 1000 | 启动 G.2 pgvector 可行性验证 |
| 关键词召回相关性 | < 70% 人工评估 | 启动 G.0 全文 + G.2 语义混合检索 |
| 出现跨章因果分析需求 | 实际功能请求 | 启动 G.4 图数据库选型 |

---

## 6. 总结

- 当前 Phase F L2+L3 闭环后，**项目在 PostgreSQL 内已经可以支撑长篇连续性的核心场景**。
- Phase G 是后续可选项，**不是 MVP 必备**。
- 引入任何新基础设施前必须先有评估基线。
- 当前可执行的准备工作只有"抽象 Retriever 接口"和"召回质量基线统计"，其他都要等真实规模数据。

> 如未来开始 Phase G，请先在 `docs/plans/` 下创建独立计划文档（如 `phase-g.0-fulltext-search.md`），不要直接动 schema。
