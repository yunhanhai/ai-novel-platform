# 去AI味报告可信度与完整输入计划

实际DB RED确认：散文响应SUCCEEDED100；8500后尾部未输入；来源正文已变仍保存报告；CANCELLED被SUCCEEDED覆盖。

设计：严格报告解析(JSON对象、score0..100、非空摘要、合法issues)，每条matched必须在来源正文有准确位置或唯一可校正匹配，歧义/不存在拒绝，不默认无问题。完整输入<=20000 Unicode字符，超限请求前失败。合法报告保留完整issues与来源hash/字符数，UI展示辅助分与证据，不能自动改文。

worker步骤先RUNNING，成功/失败/取消有终态和实测耗时；配置异常保持原分类。最终锁来源章→范围job，校验正文/attempt/status后同事务保存step/report，取消或旧attempt结果丢弃，不覆盖任务。未知故障仍交原poll重试；合法模型用量即使报告无效仍记录。

备选继续降级为无问题会误导；无边界全章输入成本不可控；隐式分片增加调用。本轮不新增供应商调用、不动规则扫描或正文编辑流程。

1. RED解析/handler回归(非法JSON/结构/score/伪引用/尾部/Unicode上限)。
2. 最小实现及GREEN，使用真实DB回滚验证无效报告、完整章尾/超限0call、stale/cancel/attempt、合法issues/step/usage及事务回滚。
3. UI展示合法报告(不自动应用)，浏览器fake明确失败+受控合法报告渲染，完整unit/typecheck/build/e2e及独立审查。
4. 更新progress/localization/onboarding/report，提交快进master同步双远程hash，证据外存。既有真实正文/13记忆与配置不变，无schema迁移部署。
