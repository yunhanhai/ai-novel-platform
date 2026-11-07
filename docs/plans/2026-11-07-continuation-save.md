# 单章续写保存确认与原文冲突计划

实际DB RED：已保存正文后补写mode结果失败，poll耗尽标FAILED，手动重试同job产生2版本/2次续写；模型等待时人工保存被旧结果覆盖。

设计：独立续写将mode/addedChars/targetLength随正文/version/job/usage一次事务finalize，不再有额外成功写入。执行前及提交事务内，以同job、章、组织项目AI版本作为已有保存凭证；重试仅恢复结果不调模型不改当前正文。锁顺序保持章→job，attempt/status保护旧执行及取消。

单/批量续写传请求前expectedContent，锁章后逐字核对；不同抛明确CHAPTER_SOURCE_CHANGED，poll直接失败不自动重新生成，保留人工正文/原记忆，无新版本。取消在途成功按原约定可保存当前续写但保留CANCELLED。

备选只移除第二次写状态不能覆盖提交结果返回丢失/人工重试；全局HTTP幂等键改造超范围。本轮依托已有job版本与事务，无schema/模型/前端流程修改。

1. RED单测：结果元信息同事务、无后写成功、同job版本恢复不调用模型、原文变化不覆盖；真实DB原始RED已回滚。
2. 最小实现及GREEN，补旧attempt/重复提交/取消/终态恢复后已被人工改文不回滚；batch expectedContent同一冲突门。
3. 实际PostgreSQL回滚handler/poller模拟提交确认丢失/事务失败/重试、manual并发更改、同job双执行；不发外部模型请求。
4. 全量unit/typecheck/build/e2e，独立审查，更新report/progress/localization/manual；提交快进master同步GitHub/Gitee并外存hash回执。保护既有真实800字章/13记忆和配置，无迁移部署。

完成：1112单测+1skip、typecheck5/5、build、e2e7pass+1skip；10项真实DB全回滚，独立70定向通过。报告`reports/2026-11-07-continuation-save.md`。
