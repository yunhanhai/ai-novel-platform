# 上下文人工选择稳定性与恢复计划

目标：用户排除的记忆在新增、重抽取或顺序变化后仍只作用于该条记忆；页面能撤销排除，恢复自动选择。

方案：复用数据库ProjectMemory.id，在共享packet内使用memory:<id>，由web/worker都传真实ID。移除基于数组下标的标识；不改变章节时序、安全过滤、20条查询上限和token预算。比内容hash更能区分同文不同来源，比保留位置并加版本号更简单。旧位置标识不再匹配，旧页面需刷新，避免错误转移到其他记录。

1. RED测试：相同memory id在插入、重排后仍可排除且其他条目保留；同文不同来源不误排；worker捕获plan/draft和web预览均使用真ID。
2. 最小修复shared MemoryInfo/id及两个映射；现有测试fixture补真实标识。
3. 页面显示“已排除”分组和“恢复”动作，沿用options排除开关；完整e2e验证实际点击排除、刷新列表后仍选中目标、恢复后提示词重新出现。先在原实现观察失败再改UI。
4. PostgreSQL回滚夹具验证实际插入新记录后旧排除保持，worker真实提示词只含允许项；不调用外部模型、不改已有真实内容。
5. 全量单测/typecheck/build/e2e、审阅diff、更新progress/localization/manual/report，提交并快进master，同步GitHub/Gitee及独立核验hash。无迁移/部署/凭据变更。

完成：1082单测+1skip、typecheck5/5、build、完整e2e3pass+1skip；4项实际DB夹具全回滚、外部调用0。报告`reports/2026-11-07-context-selection.md`记录兼容与未验边界。
