# 上下文排除与关键词激活一致性计划

目标：本次排除的记忆不再触发世界项/角色关键词激活；有效排除项在失去触发条件后仍可恢复，排除优先于强制。

最小设计：共享packet在调用activateByKeywords前，从triggerText剔除excluded memories，从keywordSources剔除excluded角色/世界项；原始有效资产全集仍用于展示和恢复，excluded列表从allAssets生成。forced列表过滤excludedIds，避免报告同时计为强制和排除。web/worker共用，无schema和API改动。

备选仅在输出提示词末端再过滤无法消除间接激活；改造完整依赖图成本较大，本轮按已有显式关键词规则修复。不改title/outline等独立来源；同一词仍在其他允许素材中出现时可以激活。

1. RED纯测试覆盖被排除记忆的独占关键词、章纲独立触发、排除source的activation报告、inactive排除可恢复、force/exclude冲突。
2. 最小实现共享逻辑，真实worker plan/draft回归捕获；保护章节顺序/来源失效/预算/稳定ID。
3. 真实PostgreSQL事务回滚验证preview与worker一致及恢复；完整浏览器增加记忆→世界项独占激活→排除→失活→恢复。
4. 独立只读审查、全量单测/typecheck/build/e2e，更新进度/计划/手册/报告。零外部模型调用，不改既有验收正文或配置。
5. 提交任务分支，快进master，同步GitHub/Gitee并读取双远程hash，回执外存。

完成证据：1088单测+1skip、typecheck5/5、build、e2e3pass+1skip；5项DB回滚、独立55项通过。报告`reports/2026-11-07-context-exclusion.md`，外部调用0。
