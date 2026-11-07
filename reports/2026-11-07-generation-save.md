# 2026-11-07 整章生成保存保护

## 结果与原始证据

整章生成现在与续写共用保存凭证、任务行锁及正文快照保护。模型计划/草稿期间正文被作者修改时，旧结果明确CHAPTER_SOURCE_CHANGED失败且不自动重试，不覆盖新稿或失效其记忆。同job已有AI版本时仅恢复任务结果，不重复生成或回滚后续人工编辑；取消状态及其他attempt不会被迟到执行覆盖。

真实PostgreSQL原始RED复现三项：plan期间人工保存后旧稿覆盖新正文；取消后finalize将CANCELLED改成SUCCEEDED；同job再次RUNNING重放4次合成调用、保存2版本。夹具整体回滚，没有改动既有真实验收内容。

## 实现

- 将此前continuation-save实现提取为chapter-save共用模块，只允许GENERATE_CHAPTER/CONTINUE_CHAPTER，绑定组织/项目/job类型，参数化SQL并按数据库枚举映射核对attempt/status。旧续写文件保留兼容导出，异常类保持同一对象，poll原有处理继续生效。
- 整章handler启动前检查当前RUNNING+attempt，先查同job AI版本凭证再解析模型。loadChapter增加完整正文快照，finalize显式generationResult与expectedContent，锁章→job后再查同job版本并逐字比较原文。
- 正文、版本、记忆维护及合法抽取、job结果、usage保持同事务；提交确认丢失先核对receipt。重复或其他执行已完成时不再写正文，poll不把另一成功交付错误定为失败。
- 取消期间在途有效稿可以保存一次，但只写output、保留CANCELLED及取消时间/原因；返回取消标识给handler，禁止该取消结果派发deep诊断。
- 未修改DESLOP分析链路：该worker当前只保存分析报告，本轮保护的是整章生成的正文保存。中文提示、13任务、模型重试分类、token预算和批量断点沿用。

## 验证

1. 实际DB原始RED证明人工编辑/取消/重放三项；自动回归先观察原稿冲突不被拒绝，再实现GREEN。新增生成保存恢复不解析模型、取消不派deep子任务、提交确认丢失识别等行为测试。
2. 真实PostgreSQL8项回滚：作者改文保留、0版本/0requeue/原accepted记忆未失效；deep取消保留CANCELLED、1版本且0诊断子任务；同job恢复1版本/2次原合成调用、后人工稿不回滚且不解析模型；末attempt确认丢失仍SUCCEEDED1版本；旧attempt不得写；相同job在终态及重新RUNNING时重复提交均拒绝；最后attempt竞争成功不被poll误标FAILED；结果写故障savepoint回滚正文/版本/记忆。均实际handler/finalize/poller配合真实数据库，模型为合成返回，网络调用0。
3. 全量1116 passed+1 skipped（db32/shared67/adapters50/worker327/web640），typecheck5/5、生产build、diff check通过。新增状态/版本委托使旧只模拟章节的测试缺方法，已补测试fixture；合法抽取测试模拟锁后正文随事务更新，保持真实顺序而不放松校验。
4. 独立只读审查5个文件73项通过，无阻断；确认共享receipt、原文快照、取消/attempt及续写/批量回归，未修改文件、读凭据或发起模型调用。
5. 完整e2e7 passed+1 skipped（1.8m，进程级fake），smoke56.1秒。首轮并行全量测试时smoke已走完断言并打印通过，但结束触及60秒总时限，保留失败记录；无修改时限或产品代码，单独完整重跑通过。不将并行负载下的超时藏为成功。
6. 配置密钥排除扫描通过，私有env保持ignored；既有真实800字章/13记忆、模型配置不变，无schema/迁移或部署。本轮无外部模型调用。

## 限制

同job版本是保存凭证，凭证被清理或校验持续不可用时无法可靠确认，沿用原始错误；不保证供应商HTTP只调用一次。逐字比较不检测正文改后又完全还原的ABA过程，也不保护设定/章纲在请求期间的变化。

deep诊断仍是事务外后续任务；取消已在finalize被观察到时不派发。正文提交成功但确认丢失后的恢复不会自动补发deep诊断，避免重复；取消接口在提交后迟到写入的竞态、可靠子任务投递及其他分析/编辑路径不在本轮扩展。作者可单独运行诊断，不能把正文成功视为诊断已验收。

本轮没有新的真实模型质量/渠道稳定性结论，也不批量修正过去已取消或重复的历史正文。恢复仅修job元数据，当前作者正文不会被历史AI版本替换。

## 交付

临时分支codex/generation-save基于f749909，完成后快进master同步GitHub/Gitee；双远程master独立读取，与两本地checkout及tree核对，最终回执外存。证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-generation-save-4aa2931d`保存RED/GREEN、DB8项回执、完整检查/失败日志、独立审查及Git回执。原实验工作树保留。
