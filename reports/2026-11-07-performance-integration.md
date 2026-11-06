# 2026-11-07 性能功能安全集成验收

## 已完成能力

基于 master `b4db845` 在 `codex/performance-integration` 独立工作树选择性迁移旧性能分支及其预算原稿，保留当前会话认证、13 类任务、人工版本/eval 证据、中文 prompts、CJK token 估算、配置错误立即失败和批量续写。

| 旧分支成果 | 集成处理 |
| --- | --- |
| 质量模式、诊断任务、重试字段、心跳及其迁移 | master 已有成熟实现，保留；不覆盖历史迁移、不复制旧 handlers |
| 组织/项目趋势、项目排行、健康提示 | 迁入，按会话组织查询；UTC 窗口有上下界；仅汇总存储用量记录 |
| 成本预算与未提交设置界面 | 迁入已有 performance_budgets 表；项目覆盖→组织默认→env；正整数校验，清除恢复继承，并发保存有冲突重试，重复清除幂等 |
| 队列观测、手工失败重试、租约回收、恢复审计 | 迁入；更新必须匹配原状态/锁/尝试次数，恢复与审计同一事务；业务数据按会话组织隔离，部署级心跳沿用 master 语义 |
| 上下文预算和指纹 | 迁入，取用户 preset 与质量模式预算较小值；CJK 估算；SHA256 包含组织/项目/章节/选项/实际上下文和源更新时间，不输出原文 |
| 独立任务用量证据 | DESLOP、诊断、记忆抽取补用量；保留主生成/续写/批量续写事务内聚合事件，避免重复计量 |
| 老认证、老任务路由、旧重试/心跳、旧脚手架及英文提示 | 由当前 master 对应实现替代，不回退 |
| 工作树 Next 根目录配置 | 迁入 outputFileTracingRoot / turbopack.root，保持编译边界指向当前工作区 |

原实验分支 `8b94d14` 的提交历史在最终集成中保留父历史；原工作树的 17 个修改文件和 8 个未跟踪文件逐字节未改动，继续保留。原分支本身的默认组织身份问题仍属于历史版本，使用集成后的 master 运行。

## 安全与数据正确性

- 新增趋势、预算、队列、恢复审计路由均 await requireSession；无 cookie 401；跨组织预算读写和项目趋势访问 404。没有修改当前 master 的 context/proxy。
- 手工重试使用 organizationId+FAILED 条件更新并重置尝试次数；回收租约匹配 lockKey、leaseExpiresAt、attemptCount，忽略已被并发认领的记录。
- 审计与恢复同一事务：审计写入失败会回滚任务状态；只返回允许的元数据，隐藏内部错误。
- 独立复核发现并修复重复清除 P2025、部分成本缺失提示消失、统计口径误称调用次数三项 P2，新增回归先 RED 后 GREEN。
- 面板名称为“用量记录 / 已知成本 / 记录耗时”。生成任务的用量记录包含多个步骤合计；它不是精确供应商 HTTP 次数。成本覆盖数保留，缺失成本显示提示，已知小计超过阈值仍告警；不推算缺失价格。

## 实跑验收

- `pnpm test`：954 passed + 1 skipped，db 21 / shared 52 / model-adapters 38 / worker 237 / web 606。
- `pnpm typecheck`：5/5 workspace 通过；`pnpm build` 生产构建通过。
- `pnpm db:validate`：schema valid；`prisma migrate status`：现有 10 个迁移已应用，无需新迁移。
- `pnpm test:e2e`：3 passed + 1 skipped（最终修复环境后 1.2m）。原核心链路和设置 CRUD 保持通过；新增双组织验收覆盖匿名 API 401、跨组织 404、预算并发创建/清除、保存设置界面、趋势/队列/恢复审计隔离。
- smoke 新增实际工作台“性能”标签与上下文预算摘要显示断言。
- `scripts/verify-performance-integration.ts`：8 项真实 PostgreSQL 约束与事务验收通过：负预算、反向阈值、scope/project 不匹配、重复活动预算均被 DB 拒绝；跨组织重试隔离、失败审计回滚任务、成功重试与审计、租约恢复均通过。脚本整体事务回滚，不留夹具。
- 桌面和 390px 手机截图已检查，手机无横向溢出；截图保存在仓库外证据目录。
- 原实验工作树 25 文件 SHA256 与此前备份一致；凭据、正文、依赖、生成产物不纳入提交。

本轮不调用真实模型，fake 模式仅验收流程；未做真实供应商、真实成本与生成质量评分。e2e 复用 ai_novel_platform，按现有模式创建测试账号/项目；数据库验证脚本新增夹具回滚。无生产部署、无数据库重置。

## 运行问题与修复证据

初次新增 e2e 使用错误 CSS 选择器，修正后通过。多次 dev 启动时出现动态路由间歇 404；磁盘归属与单独 HTTP 探针正常，之后明确当前工作树根目录并保留旧缓存后重新编译。该工作树还发现 pnpm pg 包缺失，按冻结锁文件 force install 恢复依赖，锁文件未变。修复后的全量测试、类型和完整 e2e 均通过，不以失败轮次代替最终证据。

Prisma engine 下载因 TLS 失败时仅使用原主工作区同版本 schema engine 的单进程路径完成 generate，没有更改全局配置。新功能未改 Schema，未执行迁移。

## 可复核材料

计划：`docs/plans/2026-11-07-performance-integration.md`。

数据库验收命令：

```powershell
# 在 apps/worker 目录执行
pnpm exec tsx --env-file=../../.env ../../scripts/verify-performance-integration.ts
```

完整日志、截图和最终 Git 回执：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-performance-integration/`。测试用例与验收脚本随代码提交；用户正文、测试账号 cookie 和实际密钥不提交。

最终集成后合并回 master，并推送 GitHub / Gitee，远程提交和文件树核对回执保存在该仓库外目录。
