# 均衡生成容错与有限复验

目标：避免可选步骤或异常响应丢失有效正文，保留真实质量与失败证据。

1. 先RED复现：review={} / 非JSON / passed=false无issues；抽取timeout；草稿空白；修订空白/timeout。
2. review按对象/字段/枚举校验，无效即明确告警，不声称审校通过；passed=false但无建议触发现有一次修订。
3. 仅可选review/revise/extract的模型调用失败降级：步骤FAILED，已有草稿保存，generationWarnings随finalize事务落库并在UI显示。核心plan/draft及持久化错误仍上抛。空白draft禁止写入，空白revise保留上一稿并告警。
4. 审校提示明确区分观察、推断和事实：相同笔迹/未来日期仅支持怀疑，未有证据不能确证谋杀/真实寄件身份。长度及片段检查仍不是语义真值。
5. 定向RED/GREEN、独立复核、真实DB回滚故障夹具、全量单测/typecheck/build/e2e。额外一次真实balanced、最多4请求、SDK重试0、任务attempt1；只在验收runner把每请求截止延至180秒以检验旧120秒限制，不修改生产默认或全局队列。
6. 报告记录请求/用量/警告/内容质量，更新两处进度，提交集成并按授权推送两端。凭据/正文保留仓库外。
