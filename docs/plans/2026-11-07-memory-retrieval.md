# 前置章节摘要检索计划

目标：重抽旧章或新增大量accepted事实不再将邻近章节摘要挤出全部20条候选，web预览与worker采用相同确定性规则。

设计：db共享findGenerationMemories，最多20条；先按来源章实时chapterNo倒序取最多5个不同来源的accepted章节摘要，同章createdAt/id倒序取最新；余下槽位沿用createdAt/id倒序的有效accepted记忆，排除已选ID并去重。两个查询均保持org/project、来源未删除且严格前章过滤；source-null人工记忆可进入剩余槽位。不扩大token预算，候选仍可能被预算裁剪。

备选单纯提高take会增加无关上下文和成本；所有记忆只按章号排序会损失人工项目事实的原通道。本轮只为连续性预留有限摘要槽位，无新检索基础设施/语义评分。

1. 已真实DB回滚RED：第29章摘要被第1章21条新事实挤出第30章20条候选。
2. 写helper和两端回归RED：近章优先/同源一条/剩余槽位/首章人工记忆/稳定tie-break和安全过滤；最小实现共享查询。
3. 真实DB回滚验证21条挤占、6章选最近5/同源新旧、实时重排、deleted/future/foreign排除、source-null通道、web与worker提示词一致；零外部模型请求。
4. 全量unit/typecheck/build/e2e，独立只读复核，更新report/progress/localization/onboarding。
5. 提交任务分支快进master同步GitHub/Gitee，独立读远程hash外存，不改旧真实章/13记忆或模型配置，无schema/迁移/部署。

完成：1091单测+1skip、typecheck5/5、build、e2e7pass+1skip；5项真实DB全回滚，外部模型0。报告`reports/2026-11-07-memory-retrieval.md`。
