# 2026-11-07 单章续写保存确认与原文冲突

## 结果与原始问题

单章续写现在把mode、追加长度、目标长度与正文/AI版本/job/usage一次事务保存，删除正文已成功后的第二次结果写入。相同job已经有保存版本时，恢复仅修任务元数据，不重新调用模型或回写当前正文。单章和批量续写提交前均在章节行锁下核对模型请求前的完整正文；正文已变则明确CHAPTER_SOURCE_CHANGED停止自动重试，保留作者新稿。

修改前真实PostgreSQL及handler/poller复现：正文提交后补写结果失败，maxAttempts耗尽将已保存任务FAILED，手动重试同job产生2版本/2次续写；模型等待期间人工改文被旧结果覆盖。原始夹具整体回滚，未修改用户正文。

## 修改

- continuationResult随commitFinalize原事务输出保存，保留非续写生成和已有batch checkpoint机制。单次续写调用开始先校验任务RUNNING及attempt，按组织/项目/章/job/source=AI查询已存版本，恢复在模型配置解析前完成。
- 续写提交锁顺序章→job，核对类型/组织/项目/attempt及状态，事务内再次检查同job版本。已有版本或已结束/被其他attempt接手时不再写正文；poll对这类过期交付直接结束，不把另一成功结果改成失败。
- expectedContent仅对单次/批量续写显式启用，锁章后比较完整正文；空正文兼容null。冲突异常由poll定稿FAILED/CHAPTER_SOURCE_CHANGED，沿用attempt条件，禁止自动重新请求模型覆盖新稿。
- 取消期间在途续写仍可保存一次正文，但不覆盖CANCELLED、取消时间和原因。恢复已存版本仅修job结果，不恢复历史正文；后续作者修改或版本恢复不被该恢复路径回滚。
- 事务返回错误时先重新核对保存凭证，确认已提交就保持成功，避免最后一次尝试因确认丢失误标FAILED；凭证核验持续不可用时保留原始错误，不能假称保存成功。

## 验证

1. 真实DB原始RED确认后写结果失败→手动重试重复追加、在途人工编辑丢失；单测先RED观察事务输出缺mode及旧请求覆盖新正文，再GREEN。另RED覆盖最后一次执行被重复结果误标FAILED、提交已成功但返回错误需按receipt识别。
2. 真实PostgreSQL10项事务回滚：原子结果不存在第二次success写；提交确认模拟丢失即时核对成功，重试恢复不解析模型且保留后人工改文；single/batch在途改文冲突0新版本、0requeue；batch第2轮冲突保留第1轮checkpoint和人工新稿；取消在途成功仅1版本且CANCELLED；同job重复提交在SUCCEEDED及重新RUNNING状态都拒绝；旧attempt不写正文/版本；last attempt同轮竞态不误标失败；事务结果写失败savepoint回滚正文/版本。模拟确认丢失不冒充真实网络断线。
3. 全量1112 passed+1 skipped（db32/shared67/adapters50/worker323/web640）；独立只读5文件70项通过无阻断，diff check通过。最后补确认丢失识别后相关61项定向回归通过；最终catch增量由主智能体RED/GREEN与实际DB验证，后续审查没有额外复跑，不把早先独立结论当此增量的新增复核。
4. 完整e2e7 passed+1 skipped（1.4m，fake）覆盖原单次/批量追加、抽取告警、版本、失效、设置与上下文竞态。浏览器不注入真实供应商故障；恢复与并发正文证据来自真实数据库故障夹具。
5. 第一轮typecheck/build受Next dev生成validator.ts尾部损坏影响失败，已核对损坏内容并将生成types目录移至证据目录保留；服务停止后typecheck5/5与生产build重新通过，不修改业务源码掩盖错误。
6. 最终浏览器曾在版本对比返回text/html404，trace确认不是业务“版本不存在”JSON；保留失败日志后完整重跑。开发环境取消请求日志中的ECONNRESET不被当作外部模型失败。
7. 凭据排除检查通过，私有env保持ignored；进程级fake覆盖结束恢复。外部模型调用0，不改既有800字真实章/13记忆及供应商配置，无schema/迁移/部署。

## 边界

本轮保护单/批量续写的已保存正文与请求前后冲突，不扩展整章生成、DESLOP或全部编辑器路径的并发协议。逐字比较无法识别原文被改后又完全还原的ABA历史；仅改标题等不改变正文不会冲突。

供应商请求不保证exactly-once：并发worker可能先发送请求，提交时才拒绝过期结果；用户仍可能为失败/冲突请求产生费用，未新增失败用量估算。凭证确认持续不可用时任务可能仍按原错误失败，后续同job重试有可用版本则恢复而不再追加。历史凭证被删除无法可靠恢复，不自动清理或批量修正旧任务。

恢复输出指向已保存的AI版本，不表示当前作者正文与该版本一致，也不将accepted记忆当语义核准。真实模型质量与渠道稳定性未在本轮扩大验证。

## 交付

临时分支codex/continuation-save基于44fcc71，完成后快进master同步GitHub/Gitee；独立读取双远程master，与两本地checkout及tree核对，最终回执保存在仓库外。证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-continuation-save-896386be`保存原始RED、DB10项回执、单测/类型/构建、浏览器失败及通过日志、生成文件备份、独立审查与Git回执。原实验工作树保持。
