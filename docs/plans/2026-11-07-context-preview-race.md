# 上下文预览请求顺序与章节隔离计划

目标：只有当前章节/选项的最新预览请求可以写入成功、错误和loading；切章/卸载不接收旧响应，章节临时排除/强制不能传给另一章。

采用项目performance-panel已有effect scoped AbortController，手动刷新只变refreshKey，cleanup中abort。signal.aborted保护JSON解析后、catch及finally。按chapterId键隔离选择和预览，预算preset由外层保留；AiPanel存储选项时同时记录来源章节，提交时核对来源。

仅比较请求序号也可阻止乱序但不能取消请求；引入全局缓存/新状态库超出当前问题。本轮复用现有React模式，不修改API或worker。

1. 浏览器RED：拦截并暂存真实预览响应，刻意忽略abort以验证迟到响应保护；新预算响应后再释放旧成功/错误，不能覆写；旧请求结束不能关闭新请求loading。
2. 最小实现并GREEN；切章持有A响应后进入B，确认排除列表清空、B提示词保留；释放A成功/错误仍保持B；卸载后释放响应再返回也无残留。
3. 全量unit/typecheck/build/e2e与独立只读审查；不增加依赖、不调用外部模型、不改凭据/旧正文。
4. 更新progress/localization/onboarding/report；提交任务分支，快进master，同步GitHub/Gitee，双远程hash独立核验外存。

完成回执：1088单测+1skip、typecheck5/5、build、e2e7pass+1skip；4项真实浏览器受控时序用例、独立13项通过。报告`reports/2026-11-07-context-preview-race.md`，外部模型调用0。
