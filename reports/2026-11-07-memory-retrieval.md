# 2026-11-07 邻近章节摘要检索

## 结果与原始证据

生成及网页预览现在在最多20条记忆候选内，先选最多5个最近前置来源章节的accepted摘要，每章一条，再按创建时间补足其他有效accepted记忆。来源章实时编号决定距离，同章按createdAt/id倒序取最新；重新抽取旧章不再单凭较新创建时间占满全部候选。

修改前真实PostgreSQL回滚夹具复现：当前第30章，第29章摘要创建较早，第1章随后新增21条accepted事实。原createdAt desc take20选到20条旧章事实，网页提示词完全没有邻章摘要，记录nearSummaryInPrompt=false。该问题由实际查询证明，不以模型表现倒推。

## 修改

- DB共享findGenerationMemories供web/worker调用。第一查询限定租户/项目、accepted、chapter_summary、非空来源，来源未删除且chapterNo < 当前章；按来源章号desc/createdAt desc/id desc，distinct来源章，take5。
- 第二查询继续按createdAt desc/id desc补足20条；保留相同来源安全过滤及source-null人工记忆通道，排除已选ID和5个预留来源的其他摘要副本。合并按ID去重并上限20。
- 不扩大token预算或模型调用。5条属于候选优先顺序，进入共享packet后仍受预算及人工排除；不能声称所有摘要一定进入最终请求。预留未满时，剩余槽位自动扩大。
- 不修改schema/索引/迁移，不回写历史记忆或生成正文；source-null记忆不进入预留5条，但仍可竞争剩余创建时间槽位。

## 验证

1. 修改前真实DB基线RED如上；helper回归先观察缺实现失败，两端回归补最近摘要查询断言。最小修复后DB7/worker24/web2定向通过，再补五个预留槽位总20条检查。
2. 真实PostgreSQL五项回滚验证：6章摘要和21条早章新事实中选最近5个不同来源；同来源新旧只预留最新、总20且人工无来源记忆可入；self/future/跨项目来源排除，重复读取排序稳定。
3. 补测source-null且memoryType=chapter_summary的人工摘要，真实DB观察到初版NOT组合因SQL NULL语义误排；改为显式OR保留空来源，并先RED后GREEN验证。首章普通人工记忆和人工摘要均保留，存在预留来源时也均能进入剩余槽位。
4. 实际web预览及createHandlers→worker plan/draft捕获均含邻近摘要，2次合成响应无外部请求。真实reorder将旧第1章移到当前之前，其最新摘要升至第一；原邻章移至未来后被排除，已预留来源的历史副本不进入剩余槽位。软删除后派生记忆全部排除，首章仅取source-null。事务整体回滚，不留夹具或修改既有真实章。
5. 全量1091 passed+1 skipped（db29/shared67/adapters50/worker305/web640），typecheck5/5、生产build及diff check通过。
6. 完整e2e7 passed+1 skipped（1.3m，进程级fake）通过，覆盖原smoke/settings、排除/恢复、激活与异步预览边界；新增检索行为主要由真实DB及实际worker提示词验证，未把浏览器fake当语义验收。
7. 独立只读复核3个定向文件34项通过，无阻断项；确认最近不同来源、实时顺序、显式空来源分支及distinct扫描限制。其建议补记人工摘要实跑与修正，已加入本报告。
8. 凭据排除检查通过，私有env保持ignored；本轮无外部模型调用，不提交凭据、用户正文或数据库私有内容。

## 限制

5条预留是有限连续性策略，不证明最佳检索数或文学质量。其它15条仍按创建时间竞争；未预留旧来源的历史重复摘要可能继续出现，未做全库清洗或语义去重。人工排除/force仍只作用于已查询候选，不能绕过来源安全过滤。

Prisma distinct可能在查询引擎中去重；take限制返回候选数，不能等同数据库只扫描5行。本轮为检索正确性优化，新增一次顺序查询，没有大规模数据延迟/内存基准，不能声称性能提升。两次读取不建立生成快照，读取间或预览后并发改文/重排仍可能改变上下文；此边界沿用现有系统。

本轮不改变模型配置、既有800字真实章/13记忆、schema或迁移，无部署。真实摘要语义及供应商可靠性仍需另行验收。

## 交付

临时分支codex/memory-retrieval基于716b007，完成后快进master同步GitHub/Gitee；双远程master独立读取，与两本地checkout及tree核对，最终回执外存。证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-memory-retrieval-a4ecb68e`保存基线RED、真实DB回执、全量检查及Git回执，原实验工作树保留。
