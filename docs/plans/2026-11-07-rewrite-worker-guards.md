# 改写润色 worker 候选完整性计划

目标：延续页面来源快照，将后端REWRITE/POLISH候选也绑定当前任务轮次与worker读取正文，取消/结束任务不调用新模型，迟到响应不覆盖新轮次或已成功结果，记录实际返回响应的用量及步骤。

原始实际PostgreSQL RED：attempt1响应覆盖attempt2；来源正文已改仍SUCCEEDED；另执行已SUCCEEDED output被覆盖；启动前CANCELLED仍调用模型。所有场景0steps/0usage，合成模型，事务全回滚。

方案：当前范围job(type/org/project) RUNNING+attempt预检后校验章节选文，再解析模型；创建RUNNING步骤并记录实际耗时。返回响应用现有best-effort用量helper记录（含空白/被丢弃响应）。最终章节→范围job锁，核对来源正文与状态/attempt，同事务保存完整候选输出和step终态；取消/新attempt/已完成SKIPPED，不覆盖job。无文本在合法当前状态明确FAILED；来源冲突CHAPTER_SOURCE_CHANGED不自动retry。事务确认丢失先读本次step的终态凭证；清理仅RUNNING，保持原配置/瞬时错误分类。poll限定这些任务错误终态RUNNING+attempt。

保留mode/selectedText/newText契约，增加chapterId/sourceSha256与步骤中文标签。正文/版本/记忆不修改，不引入自动采纳、分片或额外模型调用。普通状态update条件足以防轮次但无法原子保护来源与step，故本轮使用已有事务/行锁模式；不扩展通用异步框架。

1. 新增worker/poll RED测试覆盖启动预检、在途新attempt/取消/成功、来源冲突、空白用量、确认丢失、清理失败原异常。
2. 最小实现GREEN，实际DB全回滚覆盖双类型及用量/无正文改写/原子失败，保留基线RED。
3. 独立只读复审，完整unit/e2e fake/build/typecheck与密钥排除扫描；不调供应商。
4. 更新progress/localization/onboarding/report，提交快进master同步双远程hash/tree/clean回执外存。模型语义、HTTP exactly-once、取消API迟到写和跨客户端正文版本锁未扩展。
