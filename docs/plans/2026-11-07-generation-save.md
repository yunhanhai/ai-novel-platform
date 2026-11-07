# 整章生成保存保护计划

真实DB RED复现三项：模型plan期间人工新稿被finalize覆盖；用户取消被成功状态覆盖；同job重试生成第二个AI版本。

设计：提炼已有续写保存receipt/行锁为chapter-save共用模块，兼容旧续写导出；范围仅GENERATE_CHAPTER/CONTINUE_CHAPTER。生成loadChapter读正文快照，启动前核对scope状态/attempt及已存版本，提交时锁章→job核对expectedContent/同job版本/attempt。取消在途有效稿可以保存，但保持CANCELLED；模型过程配置与中文/CJK/预算不改。

正文/version/抽取记忆/job/usage仍在同一finalize事务，确认丢失先查receipt。恢复仅job元数据，不回写后人工改文/不调模型。deep诊断副作用保留边界：取消不排队，receipt恢复不自动补发，避免重复，不声称可靠消息投递。

1. 写生成冲突/取消/replay/ack RED单测；实际DB RED已回滚。
2. 最小共享实现及GREEN，保留batch断点/续写语义与原异常分类。
3. 真实DB回滚验证manual冲突无自动重试、cancel保留、同job重交付、attempt/并发、ack恢复及deep取消不派子任务，正文/摘要/usage原子回滚。
4. 全量unit/typecheck/build/e2e及独立只读审查；更新progress/localization/manual/report，无外部模型调用/新schema/迁移/部署/真实正文更改。
5. 提交快进master同步GitHub/Gitee，独立核对hash与tree外存。

完成：1116单测+1skip、typecheck5/5、build、e2e7pass+1skip；8项DB全回滚，独立73项通过。报告`reports/2026-11-07-generation-save.md`。
